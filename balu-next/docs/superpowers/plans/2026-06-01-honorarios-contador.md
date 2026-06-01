# Honorários do Contador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a rota `/honorarios` exclusiva para usuários com role `contador`, permitindo criar, listar, filtrar e marcar como pago os honorários cobrados por cliente.

**Architecture:** Server Component na page que verifica role e carrega dados iniciais; Client Component para lista com filtros e dialog de criação/edição. Server Actions com Zod para toda mutação. `company_id` no honorário é a empresa do contador (escritório), `cliente_id` é o cliente (tabela `clientes`). `mes_referencia` é `date` no banco real — converte de YYYYMM → `YYYY-MM-01` na action.

**Tech Stack:** Next.js 15 (App Router, Server Components + Server Actions), Supabase (`@supabase/ssr`), Zod, Tailwind, Vitest (unit). Padrão: seguir `/clientes` para o list+dialog e `/notas_fiscais` para filtros.

**Spec:** PRD-Balu.md §12

---

## File Structure

**Novos:**
- `src/app/(auth)/honorarios/page.tsx` — server component; verifica role contador; carrega clientes + honorários; redireciona se não for contador
- `src/app/(auth)/honorarios/actions.ts` — `createHonorarioAction`, `updateHonorarioAction`, `marcarPagoAction`, `deleteHonorarioAction`
- `src/app/(auth)/honorarios/HonorarioList.tsx` — client component; tabela + filtros (cliente, mês, status) + botão criar
- `src/app/(auth)/honorarios/HonorarioFormDialog.tsx` — dialog criar/editar; reusa `<PopupConfirm>` para deletar

**Modificados:**
- `src/types/zod.ts` — atualizar `HonorarioSchema` (adicionar `data_vencimento` obrigatório, converter `mes_referencia`)
- `src/components/MenuLateral.tsx` — adicionar item `/honorarios` condicionado a `role='contador'`
- `src/app/(auth)/layout.tsx` — expor `userRole` via prop ou context para o MenuLateral

---

## Phase 1 — Schema e Actions (lógica pura, TDD)

### Task 1: Atualizar HonorarioSchema

**Files:**
- Modify: `src/types/zod.ts`
- Test: `src/types/zod.test.ts`

- [ ] **Step 1: Escrever testes que falham**

Adicionar ao final de `src/types/zod.test.ts`:

```typescript
import { HonorarioSchema } from './zod';

describe('HonorarioSchema', () => {
  const base = {
    cliente_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    company_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    mes_referencia: '202606',
    valor: 500,
    data_vencimento: '2026-06-10',
  };

  it('aceita payload mínimo válido', () => {
    expect(HonorarioSchema.safeParse(base).success).toBe(true);
  });

  it('rejeita mes_referencia com formato inválido', () => {
    expect(HonorarioSchema.safeParse({ ...base, mes_referencia: '062026' }).success).toBe(false);
    expect(HonorarioSchema.safeParse({ ...base, mes_referencia: '2026-06' }).success).toBe(false);
  });

  it('rejeita valor negativo', () => {
    expect(HonorarioSchema.safeParse({ ...base, valor: -1 }).success).toBe(false);
  });

  it('rejeita client_id não-UUID', () => {
    expect(HonorarioSchema.safeParse({ ...base, cliente_id: 'nao-uuid' }).success).toBe(false);
  });

  it('data_vencimento é obrigatória', () => {
    const { data_vencimento, ...sem } = base;
    expect(HonorarioSchema.safeParse(sem).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/types/zod.test.ts`
Expected: FAIL (schema atual não tem `data_vencimento` obrigatório).

- [ ] **Step 3: Atualizar o schema**

Substituir o bloco `HonorarioSchema` em `src/types/zod.ts`:

```typescript
export const HonorarioSchema = z.object({
  cliente_id:      z.string().uuid('cliente_id deve ser UUID.'),
  company_id:      z.string().uuid('company_id deve ser UUID.'),
  mes_referencia:  z.string().regex(/^\d{6}$/, 'Formato esperado: YYYYMM (ex: 202606).'),
  valor:           z.number({ invalid_type_error: 'Valor deve ser numérico.' }).nonnegative('Valor não pode ser negativo.'),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data_vencimento em YYYY-MM-DD.'),
  observacao:      z.string().optional(),
});
export type HonorarioInput = z.infer<typeof HonorarioSchema>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/types/zod.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/types/zod.ts src/types/zod.test.ts
git commit -m "feat(honorarios): atualiza HonorarioSchema — data_vencimento obrigatória"
```

---

### Task 2: Server Actions

**Files:**
- Create: `src/app/(auth)/honorarios/actions.ts`

- [ ] **Step 1: Criar o arquivo de actions**

```typescript
// src/app/(auth)/honorarios/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { HonorarioSchema } from '@/types/zod';

type Result = { ok: true } | { ok: false; error: string };

/** Converte YYYYMM → 'YYYY-MM-01' para gravar como date no banco. */
function mesReferenciaToDate(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01`;
}

async function getCompanyId(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', userId)
    .single();
  return (data?.current_company as string | null) ?? null;
}

export async function createHonorarioAction(fd: FormData): Promise<Result> {
  const raw = {
    cliente_id:      fd.get('cliente_id'),
    company_id:      fd.get('company_id'),
    mes_referencia:  fd.get('mes_referencia'),
    valor:           Number(fd.get('valor')),
    data_vencimento: fd.get('data_vencimento'),
    observacao:      fd.get('observacao') || undefined,
  };

  const parsed = HonorarioSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase.from('honorarios').insert({
    ...parsed.data,
    mes_referencia: mesReferenciaToDate(parsed.data.mes_referencia),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function updateHonorarioAction(id: string, fd: FormData): Promise<Result> {
  if (!id) return { ok: false, error: 'ID ausente.' };

  const raw = {
    cliente_id:      fd.get('cliente_id'),
    company_id:      fd.get('company_id'),
    mes_referencia:  fd.get('mes_referencia'),
    valor:           Number(fd.get('valor')),
    data_vencimento: fd.get('data_vencimento'),
    observacao:      fd.get('observacao') || undefined,
  };

  const parsed = HonorarioSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .update({
      ...parsed.data,
      mes_referencia: mesReferenciaToDate(parsed.data.mes_referencia),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', parsed.data.company_id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function marcarPagoAction(id: string, companyId: string): Promise<Result> {
  if (!id || !companyId) return { ok: false, error: 'Parâmetros ausentes.' };

  const today = new Date();
  const brt = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const dataPagamento = brt.toISOString().slice(0, 10);

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .update({ status: 'pago', data_pagamento: dataPagamento, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function deleteHonorarioAction(id: string, companyId: string): Promise<Result> {
  if (!id || !companyId) return { ok: false, error: 'Parâmetros ausentes.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/honorarios/actions.ts"
git commit -m "feat(honorarios): server actions create/update/marcarPago/delete"
```

---

## Phase 2 — UI: Form Dialog

### Task 3: HonorarioFormDialog

**Files:**
- Create: `src/app/(auth)/honorarios/HonorarioFormDialog.tsx`

- [ ] **Step 1: Criar o dialog**

```tsx
// src/app/(auth)/honorarios/HonorarioFormDialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/Toaster';
import { createHonorarioAction, updateHonorarioAction } from './actions';

export type ClienteOption = { id: string; nome: string };

type HonorarioRow = {
  id: string;
  cliente_id: string;
  company_id: string;
  mes_referencia: string; // 'YYYY-MM-01' vindo do banco
  valor: number;
  data_vencimento: string;
  observacao: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  companyId: string;
  clientes: ClienteOption[];
  editing?: HonorarioRow;
};

/** Converte 'YYYY-MM-01' → 'YYYYMM' para exibir no formulário. */
function dateToMesRef(d: string): string {
  return d.replace(/-/g, '').slice(0, 6);
}

export default function HonorarioFormDialog({ open, onClose, companyId, clientes, editing }: Props) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    fd.set('company_id', companyId);

    start(async () => {
      const res = editing
        ? await updateHonorarioAction(editing.id, fd)
        : await createHonorarioAction(fd);

      if (res.ok) {
        toast('success', editing ? 'Honorário atualizado.' : 'Honorário criado.');
        onClose();
      } else {
        setErro(res.error);
      }
    });
  }

  const cls = 'w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-md">
        <h2 className="font-semibold text-foreground mb-4">
          {editing ? 'Editar honorário' : 'Novo honorário'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-muted-foreground-2">
            Cliente *
            <select name="cliente_id" required defaultValue={editing?.cliente_id ?? ''} className={cls + ' mt-1'}>
              <option value="">Selecione…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Competência (YYYYMM) *
            <input
              name="mes_referencia"
              required
              defaultValue={editing ? dateToMesRef(editing.mes_referencia) : ''}
              placeholder="202606"
              maxLength={6}
              pattern="\d{6}"
              className={cls + ' mt-1 font-mono'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Valor (R$) *
            <input
              name="valor"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={editing?.valor ?? ''}
              className={cls + ' mt-1'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Vencimento *
            <input
              name="data_vencimento"
              type="date"
              required
              defaultValue={editing?.data_vencimento ?? ''}
              className={cls + ' mt-1'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Observação
            <textarea
              name="observacao"
              rows={2}
              defaultValue={editing?.observacao ?? ''}
              className={cls + ' mt-1 resize-none'}
            />
          </label>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={pending}
              className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-surface-2 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={pending}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50">
              {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/honorarios/HonorarioFormDialog.tsx"
git commit -m "feat(honorarios): dialog de criação/edição"
```

---

## Phase 3 — UI: Lista com Filtros

### Task 4: HonorarioList

**Files:**
- Create: `src/app/(auth)/honorarios/HonorarioList.tsx`

- [ ] **Step 1: Criar o componente de lista**

```tsx
// src/app/(auth)/honorarios/HonorarioList.tsx
'use client';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/Toaster';
import { Plus, CheckCircle, Pencil, Trash2 } from 'lucide-react';
import { marcarPagoAction, deleteHonorarioAction } from './actions';
import HonorarioFormDialog, { type ClienteOption } from './HonorarioFormDialog';

export type HonorarioRow = {
  id: string;
  cliente_id: string;
  company_id: string;
  mes_referencia: string;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string | null;
  observacao: string | null;
  clientes: { nome: string; nome_fantasia?: string | null } | null;
};

const STATUS_BADGE: Record<string, string> = {
  pago:     'bg-success/10 text-success border-success/30',
  atrasado: 'bg-destructive/10 text-destructive border-destructive/30',
  pendente: 'bg-alert/10 text-alert border-alert/30',
};

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function mesLabel(d: string) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function dataBR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

type Props = {
  initial: HonorarioRow[];
  companyId: string;
  clientes: ClienteOption[];
};

export default function HonorarioList({ initial, companyId, clientes }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus]   = useState('');
  const [filtroMes, setFiltroMes]         = useState('');
  const [showForm, setShowForm]           = useState(false);
  const [editing, setEditing]             = useState<HonorarioRow | undefined>();
  const [pending, start]                  = useTransition();

  const filtrados = rows.filter(r => {
    if (filtroCliente && r.cliente_id !== filtroCliente) return false;
    if (filtroStatus  && r.status     !== filtroStatus)  return false;
    if (filtroMes     && !r.mes_referencia.startsWith(filtroMes.replace('-', '-'))) return false;
    return true;
  });

  function handleMarcarPago(row: HonorarioRow) {
    start(async () => {
      const res = await marcarPagoAction(row.id, companyId);
      if (res.ok) {
        toast('success', 'Honorário marcado como pago.');
        setRows(rs => rs.map(r => r.id === row.id
          ? { ...r, status: 'pago', data_pagamento: new Date().toISOString().slice(0, 10) }
          : r));
      } else {
        toast('error', res.error);
      }
    });
  }

  function handleDelete(row: HonorarioRow) {
    if (!confirm(`Excluir honorário de ${brl(row.valor)}?`)) return;
    start(async () => {
      const res = await deleteHonorarioAction(row.id, companyId);
      if (res.ok) {
        toast('success', 'Honorário excluído.');
        setRows(rs => rs.filter(r => r.id !== row.id));
      } else {
        toast('error', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filtroCliente}
          onChange={e => setFiltroCliente(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="atrasado">Atrasado</option>
        </select>

        <input
          type="month"
          value={filtroMes}
          onChange={e => setFiltroMes(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        />

        <button
          onClick={() => { setEditing(undefined); setShowForm(true); }}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" />
          Novo honorário
        </button>
      </div>

      {/* Tabela */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum honorário encontrado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Competência</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-left">Vencimento</th>
                <th className="px-4 py-3 text-left">Pagamento</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map(r => (
                <tr key={r.id} className="bg-surface hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {r.clientes?.nome_fantasia || r.clientes?.nome || '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{mesLabel(r.mes_referencia)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{brl(r.valor)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_vencimento)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_pagamento)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status ?? 'pendente'] ?? ''}`}>
                      {r.status ?? 'pendente'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {r.status !== 'pago' && (
                        <button
                          onClick={() => handleMarcarPago(r)}
                          disabled={pending}
                          title="Marcar como pago"
                          className="text-success hover:opacity-70 disabled:opacity-40"
                        >
                          <CheckCircle className="size-4" />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditing(r); setShowForm(true); }}
                        title="Editar"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={pending}
                        title="Excluir"
                        className="text-destructive hover:opacity-70 disabled:opacity-40"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HonorarioFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(undefined); }}
        companyId={companyId}
        clientes={clientes}
        editing={editing as any}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/honorarios/HonorarioList.tsx"
git commit -m "feat(honorarios): lista com filtros cliente/status/mês + ações"
```

---

## Phase 4 — Page e Roteamento

### Task 5: Page `/honorarios`

**Files:**
- Create: `src/app/(auth)/honorarios/page.tsx`

- [ ] **Step 1: Criar a page**

```tsx
// src/app/(auth)/honorarios/page.tsx
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import HonorarioList, { type HonorarioRow } from './HonorarioList';
import type { ClienteOption } from './HonorarioFormDialog';

export default async function HonorariosPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verifica role contador
  const { data: roleRow } = await supabase
    .from('role_types')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (roleRow?.role as string | null) ?? user.user_metadata?.type ?? '';
  if (role !== 'Contador') redirect('/');

  // Empresa do contador
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company as string | null) ?? '';
  if (!companyId) redirect('/');

  // Carrega honorários com join do cliente
  const { data: honorarios } = await supabase
    .from('honorarios')
    .select(`
      id, cliente_id, company_id, mes_referencia, valor,
      data_vencimento, data_pagamento, status, observacao,
      clientes (nome, nome_fantasia)
    `)
    .eq('company_id', companyId)
    .order('mes_referencia', { ascending: false })
    .order('data_vencimento', { ascending: true });

  // Lista de clientes para os dropdowns
  const { data: clientes } = await supabase
    .from('clientes')
    .select('id, nome, nome_fantasia')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .order('nome');

  const clienteOptions: ClienteOption[] = (clientes ?? []).map(c => ({
    id: c.id as string,
    nome: ((c.nome_fantasia || c.nome) as string) ?? '',
  }));

  // Resumo para o header
  const rows = (honorarios ?? []) as HonorarioRow[];
  const totalPendente = rows
    .filter(r => r.status === 'pendente' || r.status === 'atrasado')
    .reduce((s, r) => s + r.valor, 0);
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <main className="p-6 max-w-6xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Honorários</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {rows.length} registro{rows.length !== 1 ? 's' : ''}
            {totalPendente > 0 && (
              <span className="ml-2 text-alert font-medium">· {brl(totalPendente)} a receber</span>
            )}
          </p>
        </div>
      </header>

      <HonorarioList
        initial={rows}
        companyId={companyId}
        clientes={clienteOptions}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

Run: dev. Logar como conta do tipo "Contador" → acessar `/honorarios`. Esperar: página carrega sem erro, lista vazia com botão "Novo honorário". Acessar como conta "Empresa" → deve redirecionar para `/`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/honorarios/page.tsx"
git commit -m "feat(honorarios): page com guard de role contador + lista inicial"
```

---

## Phase 5 — Navegação

### Task 6: Adicionar item no MenuLateral

**Files:**
- Modify: `src/app/(auth)/layout.tsx`
- Modify: `src/components/MenuLateral.tsx`

- [ ] **Step 1: Expor role no layout**

Ler `src/app/(auth)/layout.tsx`. Localizar onde `profile` é carregado. Adicionar query de role logo abaixo:

```tsx
// após obter profile/user no layout:
const { data: roleRow } = await supabase
  .from('role_types')
  .select('role')
  .eq('user_id', user.id)
  .maybeSingle();
const userRole = (roleRow?.role as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
```

Passar `userRole` como prop para `<MenuLateral>`:
```tsx
<MenuLateral userRole={userRole} ... />
```

- [ ] **Step 2: Receber role e condicionar item no MenuLateral**

Ler `src/components/MenuLateral.tsx`. Localizar a definição de `NAV`. Adicionar `userRole` à assinatura das props e inserir o item condicional:

```tsx
// Na assinatura das props:
type Props = {
  // ... props existentes
  userRole?: string;
};

// No array NAV, após o item Impostos:
...(userRole === 'Contador' ? [
  { href: '/honorarios', label: 'Honorários', Icon: HandCoins },
] : []),
```

Importar o ícone no topo (lucide-react):
```tsx
import { ..., HandCoins } from 'lucide-react';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Run: dev. Logar como Contador → menu mostra "Honorários". Logar como Empresa → item não aparece.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/layout.tsx" src/components/MenuLateral.tsx
git commit -m "feat(honorarios): item no menu lateral condicional para contador"
```

---

## Phase 6 — Verificação fim-a-fim

### Task 7: Smoke manual e typecheck final

- [ ] **Step 1: Typecheck + testes unitários**

Run: `npm run typecheck && npx vitest run`
Expected: tudo verde.

- [ ] **Step 2: Roteiro manual (conta Contador)**

1. Login → menu mostra "Honorários".
2. `/honorarios` → página carrega.
3. Clicar "Novo honorário" → dialog abre com campos.
4. Preencher (cliente, competência `202606`, valor `500`, vencimento futuro) → Criar → linha aparece na lista com status `pendente`.
5. Clicar ✅ "Marcar como pago" → status muda para `pago`, data preenchida.
6. Clicar ✏️ editar → dialog pré-preenchido → alterar valor → salvar → lista atualizada.
7. Clicar 🗑️ excluir → confirmar → linha some.
8. Filtrar por status "atrasado" → lista filtra corretamente.
9. Logar como Empresa → `/honorarios` redireciona para `/`.

- [ ] **Step 3: Commit final se houver ajustes**

```bash
git add -p
git commit -m "fix(honorarios): ajustes pós-smoke"
```

---

## Riscos / Observações

- **`role_types.role`**: verificar valor exato no banco — pode ser `'Contador'` ou `'contador'`. Ajustar comparação na page e no layout se necessário (ou normalizar com `.toLowerCase()`).
- **Join `clientes`**: o supabase-js retorna embed to-one como objeto ou array dependendo da FK. Se retornar array, usar `r.clientes?.[0]?.nome` no list. Validar em runtime.
- **`mes_referencia` como date**: o banco armazena `YYYY-MM-01`. A query retorna string no formato `YYYY-MM-DD`. O filtro por mês no frontend usa `input[type=month]` que devolve `YYYY-MM` — comparar com `.startsWith(filtroMes)` funciona direto.
- **Sem conta Contador no banco**: se não houver user com `role='Contador'` para testar, criar via Supabase Dashboard (`INSERT INTO role_types (user_id, role) VALUES ('<uuid>', 'Contador')`).
