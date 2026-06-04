# Dados da empresa: refletir a Receita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba "Dados da empresa" (empresa ativa), tornar os campos oficiais do CNPJ (razão social + endereço) read-only refletindo a Receita, com um botão "Atualizar da Receita" e uma escotilha de edição manual; manter editáveis os campos que a Receita não fornece.

**Architecture:** Uma constante compartilhada classifica os campos oficiais. Um helper puro extrai o patch oficial de uma consulta CNPJ. Uma server action `atualizarDadosReceitaAction` re-consulta a Focus, mescla sobre os valores atuais e chama o `updateCompanyAction` existente (que dispara o drift → "Sincronizar com Focus"). O form trava os oficiais e adiciona o botão + a escotilha.

**Tech Stack:** Next.js (server actions, client form), Supabase, TypeScript, Vitest. Spec: `docs/superpowers/specs/2026-06-04-dados-empresa-refletir-receita-design.md`.

---

## File Structure

- **Create** `app/src/lib/fiscal/campos-empresa.ts` — constante `CAMPOS_OFICIAIS_RECEITA` (+ `CAMPOS_MANUAIS`) e helper puro `camposOficiaisDaReceita`. **Sem `server-only`** (a constante é usada pelo form client).
- **Create** `app/src/lib/fiscal/campos-empresa.test.ts` — testes do helper + sanidade da constante.
- **Modify** `app/src/app/(auth)/configuracoes/actions.ts` — nova `atualizarDadosReceitaAction`.
- **Modify** `app/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx` — split oficial/manual, badge "Receita", botão "Atualizar da Receita", escotilha.

Comandos rodam de `app/`.

---

## Task 1: Constante + helper puro `camposOficiaisDaReceita`

**Files:**
- Create: `app/src/lib/fiscal/campos-empresa.ts`
- Test: `app/src/lib/fiscal/campos-empresa.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
import { describe, it, expect } from 'vitest';
import { camposOficiaisDaReceita, CAMPOS_OFICIAIS_RECEITA, CAMPOS_MANUAIS } from './campos-empresa';

describe('camposOficiaisDaReceita', () => {
  it('extrai razão social + endereço; ignora o que não vem do /v2/cnpjs', () => {
    const patch = camposOficiaisDaReceita({
      razao_social: 'AL PISCINAS LTDA',
      nome_fantasia: 'Fantasia',          // manual — ignora
      inscricao_estadual: '123',          // manual — ignora
      inscricao_municipal: '456',         // manual — ignora
      logradouro: 'Rua X', numero: '10', complemento: 'sala 2',
      bairro: 'Centro', municipio: 'Londrina', uf: 'PR', cep: '86010000',
      telefone: '4399999', email: 'a@b.com', // manuais — ignora
    });
    expect(patch).toEqual({
      razao_social: 'AL PISCINAS LTDA',
      logradouro: 'Rua X', numero: '10', complemento: 'sala 2',
      bairro: 'Centro', municipio: 'Londrina', uf: 'PR', cep: '86010000',
    });
  });

  it('ignora campos nulos/vazios e lookup vazio → {}', () => {
    expect(camposOficiaisDaReceita({})).toEqual({});
    expect(camposOficiaisDaReceita({ razao_social: '', logradouro: undefined })).toEqual({});
  });
});

describe('classificação de campos', () => {
  it('oficial e manual não se sobrepõem; cnpj não está em nenhum', () => {
    const oficiais = new Set<string>(CAMPOS_OFICIAIS_RECEITA);
    for (const m of CAMPOS_MANUAIS) expect(oficiais.has(m)).toBe(false);
    expect(oficiais.has('cnpj')).toBe(false);
    expect((CAMPOS_MANUAIS as readonly string[]).includes('cnpj')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/campos-empresa.test.ts`
Expected: FAIL ("Cannot find module './campos-empresa'").

- [ ] **Step 3: Implementar**

```ts
import type { CnpjLookup } from './cnpj-lookup';
import type { CompanyInput } from '@/types/zod';

// Campos de `companies` que vêm do registro da Receita → read-only no app (refletem a Receita).
// `codigo_municipio` é oficial/read-only mas NÃO vem do /v2/cnpjs (mantido pelo cadastro/snapshot).
export const CAMPOS_OFICIAIS_RECEITA = [
  'razao_social', 'logradouro', 'numero', 'sem_numero', 'complemento',
  'bairro', 'municipio', 'uf', 'cep', 'codigo_municipio',
] as const;

// Campos que a Receita NÃO fornece → editáveis manualmente.
export const CAMPOS_MANUAIS = [
  'nome', 'inscricao_estadual', 'inscricao_municipal', 'telefone', 'email',
] as const;

/**
 * Patch dos campos oficiais que a consulta de CNPJ (Focus /v2/cnpjs) realmente traz:
 * razão social + endereço. `codigo_municipio` NÃO vem do endpoint → não entra aqui.
 * Ignora valores nulos/vazios (não sobrescreve com vazio).
 */
export function camposOficiaisDaReceita(lookup: Partial<CnpjLookup>): Partial<CompanyInput> {
  const out: Partial<CompanyInput> = {};
  const set = <K extends keyof CompanyInput>(k: K, v: string | undefined) => {
    if (v != null && v !== '') out[k] = v as CompanyInput[K];
  };
  set('razao_social', lookup.razao_social);
  set('logradouro', lookup.logradouro);
  set('numero', lookup.numero);
  set('complemento', lookup.complemento);
  set('bairro', lookup.bairro);
  set('municipio', lookup.municipio);
  set('uf', lookup.uf);
  set('cep', lookup.cep);
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/campos-empresa.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/campos-empresa.ts app/src/lib/fiscal/campos-empresa.test.ts
git commit -m "feat(fiscal): classificação oficial/manual + camposOficiaisDaReceita"
```

---

## Task 2: `atualizarDadosReceitaAction`

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/actions.ts`

> Sem teste unitário: é I/O (lookupCnpj + updateCompanyAction). O helper puro já está coberto na Task 1.

- [ ] **Step 1: Adicionar os imports**

No topo de `app/src/app/(auth)/configuracoes/actions.ts`, junto dos imports existentes:
```ts
import { lookupCnpj } from '@/lib/fiscal/cnpj-lookup';
import { camposOficiaisDaReceita } from '@/lib/fiscal/campos-empresa';
import type { CompanyInput } from '@/types/zod';
```
(Se `CompanyInput` já estiver importado de `@/types/zod`, só acrescente os outros dois.)

- [ ] **Step 2: Implementar a action**

Adicionar ao final de `app/src/app/(auth)/configuracoes/actions.ts`:
```ts
export type AtualizarReceitaResult =
  | { ok: true; atualizados: Partial<CompanyInput> }
  | { ok: false; error: string };

/**
 * Re-consulta a Receita (Focus /v2/cnpjs) e atualiza os campos oficiais da empresa
 * (razão social + endereço). Mescla sobre os valores atuais e chama updateCompanyAction
 * (que valida com CompanySchema completo e bumpa o drift → "Sincronizar com Focus").
 */
export async function atualizarDadosReceitaAction(id: string): Promise<AtualizarReceitaResult> {
  if (!id) return { ok: false, error: 'ID da empresa ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: company } = await supabase
    .from('companies').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };

  const cnpj = String(company.cnpj ?? '').replace(/\D+/g, '');
  if (cnpj.length !== 14) return { ok: false, error: 'CNPJ inválido.' };

  const r = await lookupCnpj(cnpj);
  if (!r.ok) return { ok: false, error: r.error };

  const patch = camposOficiaisDaReceita(r.data);
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'A Receita não retornou dados para atualizar.' };
  }

  // updateCompanyAction valida com CompanySchema COMPLETO (endereço obrigatório), então mesclamos
  // o patch oficial sobre os valores atuais e enviamos o objeto inteiro.
  const atual: Partial<CompanyInput> = {
    cnpj: company.cnpj as string,
    razao_social: company.razao_social as string,
    nome: (company.nome as string) ?? '',
    inscricao_estadual: (company.inscricao_estadual as string) ?? '',
    inscricao_municipal: (company.inscricao_municipal as string) ?? '',
    codigo_municipio: (company.codigo_municipio as string) ?? '',
    logradouro: (company.logradouro as string) ?? '',
    numero: (company.numero as string) ?? '',
    sem_numero: (company.sem_numero as boolean) ?? false,
    complemento: (company.complemento as string) ?? '',
    bairro: (company.bairro as string) ?? '',
    municipio: (company.municipio as string) ?? '',
    uf: (company.uf as string) ?? '',
    cep: (company.cep as string) ?? '',
    telefone: (company.telefone as string) ?? '',
    email: (company.email as string) ?? '',
  };
  const res = await updateCompanyAction(id, { ...atual, ...patch });
  if (!res.ok) return res;

  return { ok: true, atualizados: patch };
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: "No errors found".

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/actions.ts"
git commit -m "feat(configuracoes): atualizarDadosReceitaAction (refletir Receita)"
```

---

## Task 3: `DadosEmpresaForm` — travar oficiais + botão + escotilha

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx`

> UI: verificada por `tsc` (sem teste unitário de form no projeto). Cada passo mostra o código exato.

- [ ] **Step 1: Imports e estado novo**

Em `DadosEmpresaForm.tsx`, acrescentar aos imports:
```ts
import { Loader2, Save, Pencil, MapPin, RefreshCw, Building2 } from 'lucide-react';
import { updateCompanyAction, atualizarDadosReceitaAction } from './actions';
```
(substituindo as linhas de import de `lucide-react` e de `./actions` existentes — `RefreshCw` e `Building2` são novos; `atualizarDadosReceitaAction` é novo.)

Dentro do componente, junto dos outros `useState`:
```ts
  const [overrideOficial, setOverrideOficial] = useState(false);
  const [busyReceita, setBusyReceita] = useState(false);
```

E logo após `const locked = !editing;`:
```ts
  // Campos oficiais (Receita) ficam travados mesmo no modo edição, salvo override manual.
  const lockedOficial = locked || !overrideOficial;
```

- [ ] **Step 2: `handleCancel` reseta o override; novo `handleAtualizarReceita`**

Trocar o `handleCancel` existente por:
```ts
  function handleCancel() {
    setForm(initial);
    setEditing(false);
    setOverrideOficial(false);
    setBusyCep(false);
  }
```

Adicionar a função (perto de `handleLookupCep`):
```ts
  async function handleAtualizarReceita() {
    setBusyReceita(true);
    try {
      const r = await atualizarDadosReceitaAction(id);
      if (!r.ok) { toast('error', r.error); return; }
      setForm((prev) => ({ ...prev, ...r.atualizados }));
      toast('success', 'Dados atualizados da Receita. Sincronize com a Focus no Diagnóstico.');
    } finally {
      setBusyReceita(false);
    }
  }
```

- [ ] **Step 3: Travar os campos oficiais (`disabled={lockedOficial}`) + badge**

Nos campos OFICIAIS, trocar `disabled={locked}` por `disabled={lockedOficial}` e marcar o badge. Os campos a alterar: Razão social, CEP (input), Logradouro, Número (+ checkbox sem-número), Bairro, Município, UF, Código município. Exemplos:

Razão social:
```tsx
      <Field label="Razão social" value={form.razao_social ?? ''} onChange={(v) => set('razao_social', v)} disabled={lockedOficial} oficial className="col-span-2" />
```
Código município:
```tsx
      <Field label="Código município (IBGE)" value={form.codigo_municipio ?? ''} onChange={(v) => set('codigo_municipio', v.replace(/\D/g, '').slice(0, 7))} disabled={lockedOficial} oficial />
```
Logradouro:
```tsx
      <Field label="Logradouro" value={form.logradouro ?? ''} onChange={(v) => set('logradouro', v)} disabled={lockedOficial} oficial required className="col-span-2" />
```
Bairro / Município:
```tsx
      <Field label="Bairro" value={form.bairro ?? ''} onChange={(v) => set('bairro', v)} disabled={lockedOficial} oficial />
      <Field label="Município" value={form.municipio ?? ''} onChange={(v) => set('municipio', v)} disabled={lockedOficial} oficial required />
```
No bloco do CEP, do Número/sem-número e do UF, trocar os `disabled={locked}` (e `disabled={locked || busyCep}` no botão Buscar) por `disabled={lockedOficial}` (e `disabled={lockedOficial || busyCep}`). Os campos MANUAIS (Nome fantasia, Inscrição estadual, Inscrição municipal, Telefone, E-mail) **continuam** com `disabled={locked}`.

- [ ] **Step 4: `Field` ganha o badge "Receita"**

Trocar a assinatura e o corpo do componente `Field` por:
```tsx
function Field({
  label, value, onChange, type = 'text', disabled = false, required = false, oficial = false, className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
  oficial?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground-2">
        {label}{required && <span className="text-destructive"> *</span>}
        {oficial && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Building2 className="size-2.5" /> Receita
          </span>
        )}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
      />
    </label>
  );
}
```

- [ ] **Step 5: Footer — "Atualizar da Receita" (read mode) + escotilha (edit mode)**

Trocar o bloco do footer (`<div className="col-span-2 mt-3 flex ...">`) por:
```tsx
      {editing && (
        <div className="col-span-2 -mb-1 text-xs">
          {overrideOficial ? (
            <p className="text-alert">Edição manual dos dados da Receita ativa — estes dados devem refletir a Receita; altere lá primeiro.</p>
          ) : (
            <button type="button" onClick={() => setOverrideOficial(true)} className="text-muted-foreground underline hover:text-foreground">
              editar dados da Receita manualmente
            </button>
          )}
        </div>
      )}
      <div className="col-span-2 mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <button type="button" onClick={handleCancel} disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={handleAtualizarReceita} disabled={busyReceita}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50">
              {busyReceita ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Atualizar da Receita
            </button>
            <button type="button" onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <Pencil className="size-4" />
              Editar
            </button>
          </>
        )}
      </div>
```

- [ ] **Step 6: Verificar tipos + lint do arquivo**

Run: `npx tsc --noEmit`
Expected: "No errors found".

(Verificação visual opcional: abrir `/configuracoes?tab=dados` — campos oficiais com badge "Receita" e travados; "Editar" libera só os manuais; "editar dados da Receita manualmente" libera os oficiais com aviso; "Atualizar da Receita" puxa e preenche.)

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx"
git commit -m "feat(configuracoes): dados oficiais read-only (badge Receita) + Atualizar da Receita + escotilha"
```

---

## Self-Review (preenchido)

**Spec coverage:** classificação oficial/manual (Task 1, constante) ✓; helper `camposOficiaisDaReceita` (Task 1) ✓; `atualizarDadosReceitaAction` + merge + reuso do updateCompanyAction/drift (Task 2) ✓; UI read-only com badge + botão + escotilha + "Buscar CEP" só no override (Task 3, CEP usa `lockedOficial`) ✓; abertura intocada (não tocamos `configuracoes/page.tsx` nem `AberturaInfoView`) ✓; `codigo_municipio` oficial mas não atualizado pelo botão (helper não o inclui) ✓.

**Placeholders:** nenhum — todo passo tem código real.

**Type consistency:** `camposOficiaisDaReceita` recebe `Partial<CnpjLookup>` e devolve `Partial<CompanyInput>` (Tasks 1 e 2 batem); `CAMPOS_OFICIAIS_RECEITA`/`CAMPOS_MANUAIS` `as const`; `atualizarDadosReceitaAction` retorna `{ ok, atualizados }` e o form consome `r.atualizados` (Tasks 2 e 3 batem); `lockedOficial`/`overrideOficial`/`busyReceita` definidos na Task 3 antes do uso.
