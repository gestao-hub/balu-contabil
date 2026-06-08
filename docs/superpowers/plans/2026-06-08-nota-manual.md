# Lançamento Manual de NF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir **lançar manualmente** uma NF já emitida fora (sem chamar a Focus), distinguindo-a das emitidas por uma coluna `origem` + status `lancada`, com dropdown "Nova nota" e filtro por origem.

**Architecture:** Coluna `origem` ('emissao'/'manual') em `notas_fiscais` + status `lancada`. Form manual unificado (tipo é um campo) que insere direto via server action, sem Focus. Dropdown "Nova nota" na lista; filtro de origem.

**Tech Stack:** Next.js App Router (server components + actions), Supabase, TypeScript, Tailwind, Vitest.

**Working dir:** `/home/allan/Projetos/claude/balu/app` (app Next em `app/`; rode `npx`/`git` daqui).

**Spec:** `docs/superpowers/specs/2026-06-08-nota-manual-design.md`.

> **Desvio do spec (intencional):** o spec dizia reusar `ItensField`, mas ele é NF-e/NFC-e específico
> (NCM/CFOP/produtos, `tipoNf: 'nfe'|'nfce'`). Para a nota manual genérica (3 tipos), usamos um editor
> de itens **simples** (descrição + valor) inline no `NotaManualForm`. `ClienteCombobox` é reusado.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/0027_notas_fiscais_origem.sql` | Create | coluna `origem` + check |
| `src/app/(auth)/notas_fiscais/notas-filtros.ts` | Modify | campo `origem` no tipo + parse + querystring |
| `src/app/(auth)/notas_fiscais/notas-filtros.test.ts` | Modify | testes do `origem` |
| `src/app/(auth)/notas_fiscais/actions.ts` | Modify | `lancarNotaManualAction` |
| `src/app/(auth)/notas_fiscais/manual/NotaManualForm.tsx` | Create | form unificado (client) |
| `src/app/(auth)/notas_fiscais/manual/page.tsx` | Create | server: carrega clientes, renderiza o form |
| `src/app/(auth)/notas_fiscais/NovaNotaDropdown.tsx` | Create | dropdown "Nova nota" (client) |
| `src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx` | Modify | dropdown + filtro Origem + tag "Manual" |
| `src/app/(auth)/notas_fiscais/page.tsx` | Modify | aplica filtro `origem` na query |

---

## Task 1: Migration — coluna `origem`

**Files:** Create `supabase/migrations/0027_notas_fiscais_origem.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- @custom — Lançamento manual de NF: distingue emissão real (Focus) de lançamento manual.
-- 'emissao' (default) = nota emitida pela plataforma; 'manual' = NF já emitida fora, só registrada.
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'emissao';

ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_origem_check;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_origem_check CHECK (origem IN ('emissao','manual'));

-- Status 'lancada' (nota manual): db_atual.sql NÃO mostra CHECK em status → texto livre, insere ok.
-- Se a base real tiver um CHECK de status, estendê-lo aqui para incluir 'lancada'.
```

- [ ] **Step 2: Aplicar (controlador aplica; o projeto Supabase do balu não está no MCP)**

O agente NÃO aplica sozinho. Reporta que a migration precisa ser aplicada via
`npx supabase db push` (se linkado) ou SQL Editor. Confirmar a coluna depois:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='notas_fiscais' AND column_name='origem';
```

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/supabase/migrations/0027_notas_fiscais_origem.sql
git commit -m "feat(migration): notas_fiscais.origem (emissao/manual)"
```

---

## Task 2: Filtro `origem` em `notas-filtros.ts` (TDD)

**Files:** Modify `src/app/(auth)/notas_fiscais/notas-filtros.ts` + `notas-filtros.test.ts`

O tipo `Filtros` hoje é `{ q, tipo, status, start, end, page }`; `parseFiltrosFromParams` lê de
`ParamsLike`; `filtrosToQueryString` serializa (omitindo defaults).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao fim de `notas-filtros.test.ts` (dentro do arquivo; ajuste o import se necessário —
`parseFiltrosFromParams`/`filtrosToQueryString` já são importados lá):

```ts
describe('filtro origem', () => {
  function params(obj: Record<string, string>) {
    return { get: (k: string) => obj[k] ?? null };
  }
  it('default origem = todos', () => {
    expect(parseFiltrosFromParams(params({})).origem).toBe('todos');
  });
  it('parseia origem=manual', () => {
    expect(parseFiltrosFromParams(params({ origem: 'manual' })).origem).toBe('manual');
  });
  it('querystring omite origem=todos e inclui os demais', () => {
    const base = parseFiltrosFromParams(params({ periodo: 'all' }));
    expect(filtrosToQueryString({ ...base, origem: 'todos' })).not.toContain('origem');
    expect(filtrosToQueryString({ ...base, origem: 'manual' })).toContain('origem=manual');
  });
});
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run "src/app/(auth)/notas_fiscais/notas-filtros.test.ts"`
Expected: FAIL — `origem` é `undefined`.

- [ ] **Step 3: Implementar no `notas-filtros.ts`**

No tipo `Filtros`, adicionar `origem: string;` (após `status`):
```ts
export type Filtros = {
  q: string;
  tipo: string;
  status: string;
  origem: string;   // 'todos' default
  start: string | null;
  end: string | null;
  page: number;
};
```

Em `parseFiltrosFromParams`, após `const status = sp.get('status') ?? 'todos';`:
```ts
  const origem = sp.get('origem') ?? 'todos';
```
E incluir `origem` no objeto retornado: `return { q, tipo, status, origem, start, end, page };`

Em `filtrosToQueryString`, após a linha do `status`:
```ts
  if (f.origem !== 'todos') sp.set('origem', f.origem);
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run "src/app/(auth)/notas_fiscais/notas-filtros.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/notas-filtros.ts" "app/src/app/(auth)/notas_fiscais/notas-filtros.test.ts"
git commit -m "feat(notas): filtro origem em notas-filtros (TDD)"
```

---

## Task 3: `lancarNotaManualAction`

**Files:** Modify `src/app/(auth)/notas_fiscais/actions.ts` (append no fim)

A action insere direto em `notas_fiscais` (sem Focus). Mira o mesmo padrão das outras actions do
arquivo (getUser → `profiles.current_company` → companyId).

- [ ] **Step 1: Append a action + tipos**

```ts
export type NotaManualItem = { descricao: string; valor: number };
export type NotaManualInput = {
  tipo: 'NFSe' | 'NFe' | 'NFCe';
  clienteId: string | null;
  numero: string;
  dataEmissao: string;          // 'YYYY-MM-DD'
  itens: NotaManualItem[];
};
export type LancarNotaManualResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Registra uma NF já emitida fora (lançamento manual) — NÃO chama a Focus.
 * Marca origem='manual', status='lancada'. Itens/número vão no payload_focusnfe (jsonb).
 */
export async function lancarNotaManualAction(input: NotaManualInput): Promise<LancarNotaManualResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  if (!['NFSe', 'NFe', 'NFCe'].includes(input.tipo)) return { ok: false, error: 'Tipo inválido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataEmissao)) return { ok: false, error: 'Data de emissão inválida.' };
  const itens = (input.itens ?? []).filter((i) => i.descricao.trim() && Number.isFinite(i.valor) && i.valor > 0);
  if (itens.length === 0) return { ok: false, error: 'Inclua ao menos um item com descrição e valor.' };
  const valorTotal = itens.reduce((s, i) => s + i.valor, 0);

  const { data, error } = await supabase
    .from('notas_fiscais')
    .insert({
      company_id: companyId,
      cliente_id: input.clienteId,
      tipo_documento: input.tipo,
      referencia: `man_${crypto.randomUUID()}`,
      data_emissao: new Date(`${input.dataEmissao}T12:00:00-03:00`).toISOString(),
      valor_total: valorTotal,
      status: 'lancada',
      origem: 'manual',
      payload_focusnfe: { manual: true, numero: input.numero, itens },
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath('/notas_fiscais');
  return { ok: true, id: data.id as string };
}
```

- [ ] **Step 2: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -i "actions.ts" | head`
Expected: sem saída. (`createServerClient`, `revalidatePath` já estão importados no arquivo.)

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/actions.ts"
git commit -m "feat(notas): lancarNotaManualAction (origem=manual, status=lancada)"
```

---

## Task 4: `NotaManualForm` (client) + rota `manual/page.tsx`

**Files:**
- Create `src/app/(auth)/notas_fiscais/manual/NotaManualForm.tsx`
- Create `src/app/(auth)/notas_fiscais/manual/page.tsx`

Reusa `ClienteCombobox` (props: `{ clientes: ClienteOption[]; value: string|null; onChange: (id)=>void }`,
`ClienteOption = { id; razao_social; document; person_type }`).

- [ ] **Step 1: Criar `NotaManualForm.tsx`**

```tsx
'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import ClienteCombobox, { type ClienteOption } from '../emissao/ClienteCombobox';
import { lancarNotaManualAction, type NotaManualItem } from '../actions';
import { brl } from '@/lib/fiscal/guia';

type LinhaItem = NotaManualItem & { _key: string };
const TIPOS = [
  { v: 'NFSe', label: 'NFS-e (serviço)' },
  { v: 'NFe', label: 'NF-e (produto)' },
  { v: 'NFCe', label: 'NFC-e (consumidor)' },
] as const;

export default function NotaManualForm({ clientes }: { clientes: ClienteOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [tipo, setTipo] = useState<'NFSe' | 'NFe' | 'NFCe'>('NFSe');
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [dataEmissao, setDataEmissao] = useState(() => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10));
  const [itens, setItens] = useState<LinhaItem[]>([{ _key: 'k0', descricao: '', valor: 0 }]);

  const total = useMemo(() => itens.reduce((s, i) => s + (Number.isFinite(i.valor) ? i.valor : 0), 0), [itens]);

  function setItem(key: string, patch: Partial<NotaManualItem>) {
    setItens((arr) => arr.map((i) => (i._key === key ? { ...i, ...patch } : i)));
  }
  function addItem() {
    setItens((arr) => [...arr, { _key: `k${Date.now()}`, descricao: '', valor: 0 }]);
  }
  function removeItem(key: string) {
    setItens((arr) => (arr.length > 1 ? arr.filter((i) => i._key !== key) : arr));
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const r = await lancarNotaManualAction({
        tipo,
        clienteId,
        numero: numero.trim(),
        dataEmissao,
        itens: itens.map(({ descricao, valor }) => ({ descricao: descricao.trim(), valor })),
      });
      if (r.ok) {
        toast('success', 'Nota lançada.');
        router.push('/notas_fiscais');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </Campo>
        <Campo label="Cliente">
          <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
        </Campo>
        <Campo label="Número da nota">
          <input value={numero} onChange={(e) => setNumero(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Ex.: 1234" />
        </Campo>
        <Campo label="Data de emissão">
          <input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </Campo>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Itens</span>
          <button type="button" onClick={addItem}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <Plus className="size-4" /> Adicionar item
          </button>
        </div>
        <div className="space-y-2">
          {itens.map((i) => (
            <div key={i._key} className="flex items-center gap-2">
              <input value={i.descricao} onChange={(e) => setItem(i._key, { descricao: e.target.value })}
                placeholder="Descrição" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <input type="number" step="0.01" min="0" value={i.valor || ''}
                onChange={(e) => setItem(i._key, { valor: Number(e.target.value) })}
                placeholder="0,00" className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular-nums" />
              <button type="button" onClick={() => removeItem(i._key)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-right text-sm text-muted-foreground">Total: <strong className="text-foreground tabular-nums">{brl(total)}</strong></p>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? 'Lançando…' : 'Lançar nota'}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Criar `manual/page.tsx`**

```tsx
// @custom — Lançamento manual de NF (registro de nota já emitida fora). Sem Focus.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import NotaManualForm from './NotaManualForm';
import type { ClienteOption } from '../emissao/ClienteCombobox';

export default async function NotaManualPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;

  const { data: clientesRaw } = companyId
    ? await supabase.from('clientes')
        .select('id, razao_social, document, person_type')
        .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
        .order('razao_social', { ascending: true }).limit(500)
    : { data: [] };

  const clientes: ClienteOption[] = (clientesRaw ?? []).map((c) => ({
    id: c.id as string,
    razao_social: (c.razao_social as string | null) ?? '—',
    document: (c.document as string | null) ?? '',
    person_type: (c.person_type as string | null) ?? 'PJ',
  }));

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <Link href="/notas_fiscais" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Lançar nota manual</h1>
        <p className="text-sm text-muted-foreground mt-1">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
      </header>
      <NotaManualForm clientes={clientes} />
    </main>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -iE "NotaManualForm|manual/page" | head`
Expected: sem saída.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/manual/"
git commit -m "feat(notas): form e rota de lançamento manual"
```

---

## Task 5: `NovaNotaDropdown` (client)

**Files:** Create `src/app/(auth)/notas_fiscais/NovaNotaDropdown.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown, FilePlus, FileText } from 'lucide-react';

export default function NovaNotaDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Nova nota <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <Link href="/notas_fiscais/emissao" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2">
            <FileText className="size-4 text-primary" /> Emitir NF
          </Link>
          <Link href="/notas_fiscais/manual" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 border-t border-border">
            <FilePlus className="size-4 text-muted-foreground" /> Nota manual
          </Link>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -i "NovaNotaDropdown" | head
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/NovaNotaDropdown.tsx"
git commit -m "feat(notas): NovaNotaDropdown (Emitir NF / Nota manual)"
```

---

## Task 6: Fiação na lista — dropdown + filtro Origem + tag "Manual"

**Files:**
- Modify `src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx`
- Modify `src/app/(auth)/notas_fiscais/page.tsx`

> **LEIA os dois arquivos primeiro.** A lista é client e recebe os filtros + as linhas via props; a
> `page.tsx` (server) faz a query. As edições abaixo são pontuais — encaixe nos pontos descritos.

- [ ] **Step 1: `page.tsx` — aplicar o filtro `origem` na query**

Na query de `notas_fiscais` da `page.tsx` (onde já há `.eq('company_id', ...)` e os filtros de
`tipo`/`status`/período), adicionar, logo após o filtro de `status`:
```ts
  if (filtros.origem !== 'todos') query = query.eq('origem', filtros.origem);
```
(Use o nome real da variável da query no arquivo — provavelmente `query`/`q`. E garanta que o
`select(...)` inclua `origem` para a lista renderizar a tag.)

- [ ] **Step 2: `NotasFiscaisList.tsx` — trocar o botão pelo dropdown**

No topo do arquivo, importar:
```ts
import NovaNotaDropdown from './NovaNotaDropdown';
```
Localizar o `<Link href="/notas_fiscais/emissao" ...>Emitir nova</Link>` (≈ linha 197) e
substituí-lo por:
```tsx
<NovaNotaDropdown />
```

- [ ] **Step 3: `NotasFiscaisList.tsx` — adicionar o filtro Origem na seção de filtros**

Junto aos selects de `tipo`/`status` na barra de filtros, adicionar um select de Origem. O padrão de
filtro do arquivo atualiza a URL via `filtrosToQueryString` (siga o mesmo handler usado pelo select
de `status`). JSX a adicionar (adapte ao handler/estado locais do arquivo):
```tsx
<select
  value={filtros.origem}
  onChange={(e) => aplicar({ ...filtros, origem: e.target.value, page: 1 })}
  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
>
  <option value="todos">Todas as origens</option>
  <option value="emissao">Emitidas</option>
  <option value="manual">Manuais</option>
</select>
```
(`aplicar` = o mesmo callback que os outros selects usam para navegar com a nova querystring.
Se o tipo da linha/`filtros` for tipado localmente, inclua `origem` nele.)

- [ ] **Step 4: `NotasFiscaisList.tsx` — tag "Manual" na linha**

A linha da tabela tem o tipo das notas (ex.: `NotaRow`) — adicionar `origem: string` a esse tipo e
mapear `origem` do dado vindo da `page.tsx`. Na célula de status/tipo, quando `n.origem === 'manual'`,
renderizar uma tag:
```tsx
{n.origem === 'manual' && (
  <span className="ml-2 inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-muted-foreground">
    Manual
  </span>
)}
```

- [ ] **Step 5: Type-check + smoke**

```
cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | head -20
```
Expected: `TypeScript: No errors found`.

Smoke (dev): `/notas_fiscais` → "Nova nota" abre dropdown → "Nota manual" → preenche tipo/cliente/
número/data/itens → "Lançar nota" → volta pra lista com a nota (tag **Manual**, status **lancada**).
Filtro **Origem = Manuais** isola; **Emitidas** esconde a manual.

- [ ] **Step 6: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx" "app/src/app/(auth)/notas_fiscais/page.tsx"
git commit -m "feat(notas): dropdown Nova nota + filtro Origem + tag Manual na lista"
```

---

## Self-Review Checklist

- [x] **Cobertura do spec:** coluna origem (T1) · filtro origem (T2) · lancarNotaManualAction (T3) · form+rota manual (T4) · dropdown (T5) · lista: dropdown+filtro+tag, query (T6)
- [x] **Status `lancada`:** gravado na action (T3); migration nota o caso do CHECK de status
- [x] **Base de imposto:** a nota manual entra em `notas_fiscais` com `valor_total`/`data_emissao` — **verificar na T6/smoke** que a apuração (`lerReceitasParaApuracao`) não exclui `status='lancada'`; se excluir, abrir ajuste (anotado como risco)
- [x] **Tipos consistentes:** `NotaManualInput`/`NotaManualItem` (T3) usados no form (T4); `ClienteOption` reusado; `origem` em `Filtros` (T2) usado na query (T6)
- [x] **Desvio do ItensField** documentado (editor simples no form)
- [x] **Sem placeholders:** código completo nos arquivos novos; edições da T6 são pontuais com o JSX exato (a T6 exige ler os 2 arquivos, por serem grandes/locais)

**Risco anotado:** confirmar que a apuração inclui notas `status='lancada'` na base de receita (o spec
pede que conte pra imposto). Se `receitas-source`/`lerReceitasParaApuracao` filtra por status, é um
ajuste extra (1 linha) — verificar no smoke da T6 e abrir tarefa se necessário.
