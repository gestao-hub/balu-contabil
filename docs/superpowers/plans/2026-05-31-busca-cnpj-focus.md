# Busca de CNPJ na Focus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar busca de CNPJ na Focus ao cadastro de empresa e melhorar a do cliente (máscara de CNPJ, inscrição estadual/municipal no autofill, mensagens de erro amigáveis), com a consulta centralizada numa lib compartilhada.

**Architecture:** Extrair a consulta de CNPJ (hoje embutida em `clientes/actions.ts`) para um módulo server-only `src/lib/fiscal/cnpj-lookup.ts` com tipo de retorno autocontido e classificação de erro. Os dois arquivos de actions (`clientes` e `onboarding`) reexportam uma `lookupCnpjAction` fina sobre a lib. Os dois dialogs (cliente e empresa) chamam suas actions e sobrescrevem os campos do form com o que a Focus retornar.

**Tech Stack:** Next.js 15 (server actions), TypeScript, Zod, Vitest. Focus NFe `GET /v2/cnpjs/:cnpj` (via `focus.consultarCnpj`, já existente). Sem migration.

---

## File Structure

- **Create** `src/lib/fiscal/cnpj-lookup.ts` — consulta de CNPJ compartilhada (server-only). Tipo `CnpjLookup`, `CnpjLookupResult`, função `lookupCnpj`, helpers de normalização e classificação de erro.
- **Create** `src/lib/fiscal/cnpj-lookup.test.ts` — testes unitários (fetch mockado, padrão de `focus-nfe.test.ts`).
- **Modify** `src/app/(auth)/clientes/actions.ts` — remover a implementação local de `lookupCnpjAction`/`CnpjLookup`/helpers; reexportar da lib.
- **Modify** `src/app/(auth)/onboarding/actions.ts` — expor `lookupCnpjAction` (reexport da lib) + atualizar comentário de cabeçalho.
- **Modify** `src/components/ClienteFormDialog.tsx` — máscara de CNPJ (PJ); IE/IM no autofill.
- **Modify** `src/components/CreateCompanyDialog.tsx` — botão "Buscar" + handler de lookup; remover comentário obsoleto.

### Convenções verificadas no codebase (seguir à risca)
- **Vitest TEM alias `@/`** (`vitest.config.ts` → `resolve.alias['@'] = ./src`) e um **stub de `server-only`** (`./src/__mocks__/server-only.ts`), então `import 'server-only'` e imports `@/...` funcionam nos testes. Usar `@/lib/clients/focus-nfe` na lib (consistente com os arquivos de actions, que já usam `@/`).
- **Testes mockam `globalThis.fetch`** via `vi.spyOn` e reimportam o módulo após setar `FOCUS_NFE_TOKEN` (padrão de `focus-nfe.test.ts`). Não há uso de `vi.mock` no projeto. O teste importa o alvo por caminho relativo (`./cnpj-lookup`).
- **Formato de erro do `call()` da Focus** (`focus-nfe.ts`): resposta com falha lança `Error("Focus <status>: <texto>")`. 5xx faz retry (3 tentativas) e relança o mesmo formato; erro de rede faz retry e relança o `Error` original. A classificação de erro do `lookupCnpj` se baseia nesse texto.
- **`formatCnpj`/`formatCep`** já existem em `src/lib/format/masks.ts`.
- **Comandos** (rodar dentro de `balu-next/`): testes `npm test -- run <arquivo>` (vitest, `run` = sem watch); typecheck `npm run typecheck`. `vitest.config.ts` inclui só `src/**/*.test.ts`.

---

## Task 1: Criar a lib `cnpj-lookup.ts` com o caso de sucesso (mapeamento)

**Files:**
- Create: `balu-next/src/lib/fiscal/cnpj-lookup.ts`
- Test: `balu-next/src/lib/fiscal/cnpj-lookup.test.ts`

- [ ] **Step 1: Escrever o teste do mapeamento (falhando)**

Criar `balu-next/src/lib/fiscal/cnpj-lookup.test.ts`:

```ts
// Testes da consulta de CNPJ compartilhada. Mocka globalThis.fetch e reimporta
// o módulo após setar FOCUS_NFE_TOKEN (mesmo padrão de focus-nfe.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PREV_TOKEN = process.env.FOCUS_NFE_TOKEN;

let lookupCnpj: typeof import('./cnpj-lookup')['lookupCnpj'];

beforeEach(async () => {
  process.env.FOCUS_NFE_TOKEN = 'test-token-123';
  vi.resetModules();
  ({ lookupCnpj } = await import('./cnpj-lookup'));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREV_TOKEN === undefined) delete process.env.FOCUS_NFE_TOKEN;
  else process.env.FOCUS_NFE_TOKEN = PREV_TOKEN;
});

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('lookupCnpj — mapeamento', () => {
  it('mapeia campos da Focus (incl. IE/IM e apelidos) e normaliza CEP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        razao_social: 'Acme Ltda',
        nome_fantasia: 'Acme',
        inscricao_estadual: '123456789',
        inscricao_municipal: '987654',
        logradouro: 'Rua A',
        numero: '100',
        complemento: 'Sala 2',
        bairro: 'Centro',
        municipio: 'Curitiba',
        uf: 'PR',
        cep: '80210-000',
        telefone: '4133221100',
        email: 'contato@acme.com',
      }),
    );

    const r = await lookupCnpj('12345678000123');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      razao_social: 'Acme Ltda',
      nome_fantasia: 'Acme',
      inscricao_estadual: '123456789',
      inscricao_municipal: '987654',
      logradouro: 'Rua A',
      numero: '100',
      complemento: 'Sala 2',
      bairro: 'Centro',
      municipio: 'Curitiba',
      uf: 'PR',
      cep: '80210000',
      telefone: '4133221100',
      email: 'contato@acme.com',
    });
  });

  it('usa apelidos `nome` e `fantasia` quando os canônicos faltam', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, { nome: 'Beta SA', fantasia: 'Beta' }),
    );

    const r = await lookupCnpj('12345678000123');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.razao_social).toBe('Beta SA');
    expect(r.data.nome_fantasia).toBe('Beta');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd balu-next && npm test -- run src/lib/fiscal/cnpj-lookup.test.ts`
Expected: FAIL — `Cannot find module './cnpj-lookup'`.

- [ ] **Step 3: Implementar a lib (mínimo pro mapeamento)**

Criar `balu-next/src/lib/fiscal/cnpj-lookup.ts`:

```ts
import 'server-only';
import { focus } from '@/lib/clients/focus-nfe';

// Consulta de CNPJ na Focus (GET /v2/cnpjs/:cnpj), compartilhada pelos cadastros
// de empresa e cliente. O endpoint só existe em PRODUÇÃO (404 em homologação) e é
// read-only da Receita, então forçamos 'prod' independente de FOCUS_NFE_ENV.

export type CnpjLookup = {
  razao_social?: string;
  nome_fantasia?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
};

export type CnpjLookupResult =
  | { ok: true; data: CnpjLookup }
  | { ok: false; error: string };

function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D+/g, '');
}

function normCnpj(s: string): string {
  return onlyDigits(s).padStart(14, '0').slice(-14);
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function mapLookup(raw: Record<string, unknown>): CnpjLookup {
  return {
    razao_social:        stringOrUndef(raw['razao_social'] ?? raw['nome']),
    nome_fantasia:       stringOrUndef(raw['nome_fantasia'] ?? raw['fantasia']),
    inscricao_estadual:  stringOrUndef(raw['inscricao_estadual']),
    inscricao_municipal: stringOrUndef(raw['inscricao_municipal']),
    logradouro:          stringOrUndef(raw['logradouro']),
    numero:              stringOrUndef(raw['numero']),
    complemento:         stringOrUndef(raw['complemento']),
    bairro:              stringOrUndef(raw['bairro']),
    municipio:           stringOrUndef(raw['municipio']),
    uf:                  stringOrUndef(raw['uf']),
    cep:                 stringOrUndef(raw['cep'])?.replace(/\D+/g, ''),
    telefone:            stringOrUndef(raw['telefone']),
    email:               stringOrUndef(raw['email']),
  };
}

export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const d = normCnpj(cnpj);
  if (d.length !== 14 || /^0+$/.test(d)) return { ok: false, error: 'CNPJ inválido.' };
  try {
    const raw = await focus.consultarCnpj(d, 'prod');
    return { ok: true, data: mapLookup(raw) };
  } catch (e) {
    return { ok: false, error: classifyError(e) };
  }
}

function classifyError(_e: unknown): string {
  // Substituído na Task 2 — placeholder mínimo só pra compilar o caminho de sucesso.
  return 'Falha ao consultar CNPJ.';
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd balu-next && npm test -- run src/lib/fiscal/cnpj-lookup.test.ts`
Expected: PASS (2 testes do bloco "mapeamento").

- [ ] **Step 5: Commit**

```bash
cd balu-next && git add src/lib/fiscal/cnpj-lookup.ts src/lib/fiscal/cnpj-lookup.test.ts
git commit -m "feat(cnpj): lib compartilhada de consulta de CNPJ na Focus (mapeamento)"
```

---

## Task 2: Classificação de erro amigável

**Files:**
- Modify: `balu-next/src/lib/fiscal/cnpj-lookup.ts` (função `classifyError`)
- Test: `balu-next/src/lib/fiscal/cnpj-lookup.test.ts`

- [ ] **Step 1: Adicionar os testes de erro (falhando)**

Acrescentar ao final de `cnpj-lookup.test.ts`:

```ts
describe('lookupCnpj — erros', () => {
  it('CNPJ inválido (≠14 dígitos) não chama a Focus', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await lookupCnpj('123');
    expect(r).toEqual({ ok: false, error: 'CNPJ inválido.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('CNPJ só com zeros é inválido', async () => {
    const r = await lookupCnpj('00000000000000');
    expect(r).toEqual({ ok: false, error: 'CNPJ inválido.' });
  });

  it('404 da Focus → "não encontrado"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'CNPJ não encontrado na Receita.' });
  });

  it('5xx repetido da Focus → "indisponível"', async () => {
    // call() faz 3 tentativas em 5xx; mockamos 503 em todas.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 503, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'Serviço de consulta indisponível. Tente novamente.' });
  });

  it('erro de rede → "indisponível"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'Serviço de consulta indisponível. Tente novamente.' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd balu-next && npm test -- run src/lib/fiscal/cnpj-lookup.test.ts`
Expected: FAIL — os casos 404/5xx/rede caem no placeholder "Falha ao consultar CNPJ." (os de CNPJ inválido já passam).

- [ ] **Step 3: Implementar `classifyError`**

Em `cnpj-lookup.ts`, substituir a função `classifyError` placeholder por:

```ts
// O call() da Focus (focus-nfe.ts) lança Error("Focus <status>: <texto>") para
// respostas com falha; erro de rede/timeout relança o Error original (ex.: "fetch failed").
function classifyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/^Focus 404\b/.test(msg) || /nao_encontrado|não encontrado|not found/i.test(msg)) {
    return 'CNPJ não encontrado na Receita.';
  }
  if (/^Focus 5\d\d\b/.test(msg) || /timeout|fetch failed|network|ECONN|ETIMEDOUT/i.test(msg)) {
    return 'Serviço de consulta indisponível. Tente novamente.';
  }
  return 'Falha ao consultar CNPJ.';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd balu-next && npm test -- run src/lib/fiscal/cnpj-lookup.test.ts`
Expected: PASS (mapeamento + erros).

- [ ] **Step 5: Commit**

```bash
cd balu-next && git add src/lib/fiscal/cnpj-lookup.ts src/lib/fiscal/cnpj-lookup.test.ts
git commit -m "feat(cnpj): classificacao de erro amigavel (nao encontrado / indisponivel / invalido)"
```

---

## Task 3: Reapontar `clientes/actions.ts` para a lib

**Files:**
- Modify: `balu-next/src/app/(auth)/clientes/actions.ts`

Objetivo: remover a duplicação. O `ClienteFormDialog` importa `lookupCnpjAction` e o tipo `CnpjLookup` de `@/app/(auth)/clientes/actions` — esses nomes precisam continuar existindo.

- [ ] **Step 1: Confirmar quem usa os helpers que vão sair**

Run: `cd balu-next && grep -n "onlyDigits\|normCnpj\|stringOrUndef\|focus\." "src/app/(auth)/clientes/actions.ts"`
Expected: as únicas ocorrências estão dentro de `lookupCnpjAction` e seus helpers (linhas ~114-150). Se aparecer uso em OUTRA função, manter aquele helper/import. (Hoje `lookupCnpjAction` é o único consumidor de `focus` e desses helpers neste arquivo.)

- [ ] **Step 2: Remover implementação local e reexportar da lib**

Em `balu-next/src/app/(auth)/clientes/actions.ts`:

1. Remover o bloco `export type CnpjLookup = { ... };` (linhas ~13-25).
2. Remover os helpers `onlyDigits`, `normCnpj`, `stringOrUndef` do lookup (linhas ~114-124) e o comentário acima (~112-113).
3. Remover a função `lookupCnpjAction` inteira (linhas ~126-150).
4. Remover o import `import { focus } from '@/lib/clients/focus-nfe';` (linha ~8) — confirmado no Step 1 que nada mais o usa.
5. Adicionar, junto aos imports do topo:

```ts
import { lookupCnpj, type CnpjLookup } from '@/lib/fiscal/cnpj-lookup';
```

6. Adicionar, após os imports (corpo do módulo, que já tem `'use server'` no topo):

```ts
export type { CnpjLookup };

export async function lookupCnpjAction(cnpj: string) {
  return lookupCnpj(cnpj);
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros. (Se acusar `focus`/helper não usado, sobrou referência — reveja a remoção.)

- [ ] **Step 4: Rodar a suíte completa**

Run: `cd balu-next && npm test -- run`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
cd balu-next && git add "src/app/(auth)/clientes/actions.ts"
git commit -m "refactor(cnpj): clientes/actions reexporta lookup da lib compartilhada"
```

---

## Task 4: Expor `lookupCnpjAction` no `onboarding/actions.ts`

**Files:**
- Modify: `balu-next/src/app/(auth)/onboarding/actions.ts`

- [ ] **Step 1: Adicionar o reexport e atualizar o comentário**

Em `balu-next/src/app/(auth)/onboarding/actions.ts`:

1. No comentário de cabeçalho (linhas 1-6), substituir:

```
// A consulta de CNPJ na Focus saiu daqui: agora só o cadastro de CLIENTE a usa
// (ver lookupCnpjAction em app/(auth)/clientes/actions.ts).
```

por:

```
// A consulta de CNPJ na Focus vive em lib/fiscal/cnpj-lookup.ts e é reexportada
// aqui (empresa) e em clientes/actions.ts (cliente) como server action.
```

2. Após os imports existentes (após `import { normalizeRegimePatch } from '@/lib/fiscal/regime';`), adicionar:

```ts
import { lookupCnpj } from '@/lib/fiscal/cnpj-lookup';

export async function lookupCnpjAction(cnpj: string) {
  return lookupCnpj(cnpj);
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
cd balu-next && git add "src/app/(auth)/onboarding/actions.ts"
git commit -m "feat(cnpj): onboarding/actions expoe lookupCnpjAction para a empresa"
```

---

## Task 5: Cliente — máscara de CNPJ (PJ) + IE/IM no autofill

**Files:**
- Modify: `balu-next/src/components/ClienteFormDialog.tsx`

Não há harness de teste de componente neste projeto; a verificação é typecheck + smoke manual (Task 7). Não inventar harness de UI (YAGNI).

- [ ] **Step 1: Importar `formatCnpj`**

No topo de `ClienteFormDialog.tsx`, adicionar ao bloco de imports:

```ts
import { formatCnpj } from '@/lib/format/masks';
```

- [ ] **Step 2: Máscara de CNPJ no input de documento (só PJ)**

Substituir o `<input>` do documento (linhas ~176-181) por:

```tsx
                <input
                  value={form.person_type === 'PJ' ? formatCnpj(form.document) : form.document}
                  onChange={(e) => update('document', e.target.value.replace(/\D/g, ''))}
                  maxLength={form.person_type === 'PF' ? 11 : 18}
                  className={`${inputCls} flex-1`}
                />
```

(O estado segue guardando só dígitos via `replace(/\D/g,'')`; o display é formatado quando PJ. `maxLength` 18 acomoda a máscara `00.000.000/0000-00`.)

- [ ] **Step 3: IE/IM no autofill**

Em `handleLookupCnpj`, dentro do `setForm((prev) => ({ ... }))` (linhas ~80-92), acrescentar logo após `razao_social: ...`:

```tsx
        inscricao_estadual: d.inscricao_estadual ?? prev.inscricao_estadual,
        inscricao_municipal: d.inscricao_municipal ?? prev.inscricao_municipal,
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros. (O tipo `CnpjLookup` agora tem `inscricao_estadual`/`inscricao_municipal`, vindos da lib via reexport.)

- [ ] **Step 5: Commit**

```bash
cd balu-next && git add src/components/ClienteFormDialog.tsx
git commit -m "feat(cnpj): cliente com mascara de CNPJ (PJ) e IE/IM no autofill"
```

---

## Task 6: Empresa — botão "Buscar" + handler de lookup

**Files:**
- Modify: `balu-next/src/components/CreateCompanyDialog.tsx`

- [ ] **Step 1: Imports (action, ícone, state)**

1. No import de `@/app/(auth)/onboarding/actions` (linhas ~10-13), adicionar `lookupCnpjAction`:

```ts
import {
  lookupCepAction,
  createCompanyAction,
  lookupCnpjAction,
} from '@/app/(auth)/onboarding/actions';
```

2. No import de lucide (linha ~7), adicionar `Search`:

```ts
import { Building2, MapPin, X, Loader2, Search } from 'lucide-react';
```

3. Após `const [busyCep, setBusyCep] = useState(false);` (linha ~51), adicionar:

```ts
  const [busyCnpj, setBusyCnpj] = useState(false);
```

4. No reset do `useEffect` quando `!open` (linhas ~62-68), acrescentar `setBusyCnpj(false);` junto dos outros resets.

- [ ] **Step 2: Handler `handleLookupCnpj`**

Adicionar logo após `handleLookupCep` (após a linha ~94):

```tsx
  async function handleLookupCnpj() {
    const digits = form.cnpj.replace(/\D+/g, '');
    if (digits.length !== 14) {
      toast('warning', 'Informe um CNPJ com 14 dígitos.');
      return;
    }
    setBusyCnpj(true);
    try {
      const r = await lookupCnpjAction(digits);
      if (!r.ok) { toast('error', r.error); return; }
      const d = r.data;
      setForm((prev) => ({
        ...prev,
        razao_social: d.razao_social ?? prev.razao_social,
        nome: d.nome_fantasia ?? prev.nome,
        inscricao_estadual: d.inscricao_estadual ?? prev.inscricao_estadual,
        inscricao_municipal: d.inscricao_municipal ?? prev.inscricao_municipal,
        logradouro: d.logradouro ?? prev.logradouro,
        numero: d.numero ?? prev.numero,
        bairro: d.bairro ?? prev.bairro,
        municipio: d.municipio ?? prev.municipio,
        uf: d.uf ?? prev.uf,
        cep: d.cep ? formatCep(d.cep) : prev.cep,
        telefone: d.telefone ?? prev.telefone,
        email: d.email ?? prev.email,
      }));
      toast('success', 'Dados do CNPJ carregados.');
    } finally {
      setBusyCnpj(false);
    }
  }
```

(`complemento` e `codigo_municipio` ficam de fora: empresa não tem campo de complemento e a Focus não devolve código do município. `formatCep` já está importado no arquivo.)

- [ ] **Step 3: Botão "Buscar" na Etapa 1 e remover comentário obsoleto**

Substituir a Etapa 1 inteira (linhas ~153-166) por:

```tsx
        {/* Etapa 1 — CNPJ (com busca na Focus para autopreencher os dados) */}
        <section className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">1. CNPJ</h3>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(e) => set('cnpj', formatCnpj(e.target.value))}
              maxLength={18}
              className="flex-1 rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
              required
            />
            <button
              type="button"
              onClick={handleLookupCnpj}
              disabled={busyCnpj}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
            >
              {busyCnpj ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Buscar
            </button>
          </div>
        </section>
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
cd balu-next && git add src/components/CreateCompanyDialog.tsx
git commit -m "feat(cnpj): busca de CNPJ na Focus no cadastro de empresa"
```

---

## Task 7: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Suíte de testes completa**

Run: `cd balu-next && npm test -- run`
Expected: tudo verde, incluindo `cnpj-lookup.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 3: Smoke manual no browser (app em :3000)**

Não rodar `next build` (o `next dev` está ativo — ver memória [[balu-build-corrompe-dev-next]]).

1. **Cliente** (`/clientes` → Novo cliente, PJ): digitar um CNPJ real → input mostra máscara `00.000.000/0000-00`; clicar "Buscar" → razão social, endereço, IE/IM, telefone, e-mail preenchidos; toast de sucesso.
2. **Cliente, erro**: CNPJ inexistente → toast "CNPJ não encontrado na Receita." (ou "indisponível" se a Focus oscilar).
3. **Cliente, PF**: alternar para PF → input do documento sem máscara, `maxLength` 11.
4. **Empresa** (menu → Nova empresa): digitar CNPJ real → "Buscar" → razão social, nome fantasia, IE/IM, endereço, CEP (mascarado), telefone, e-mail preenchidos na Etapa 3; escolher regime; criar.

- [ ] **Step 4: Commit final (se algum ajuste do smoke)**

Se o smoke exigiu ajustes, commitar. Caso contrário, nada a fazer.

---

## Notas de risco

- **`/v2/cnpjs` só responde em produção.** O smoke precisa de `FOCUS_NFE_TOKEN` de revenda válido no `.env.local`. Se a Focus devolver campos com nomes fora dos mapeados (ex.: `inscricao_estadual` ausente), o autofill deixa o campo como está — best-effort, não quebra.
- **IE/IM podem não vir.** Confirmado no design como best-effort; sem erro quando ausentes.
- **Remoção de helpers no Task 3:** o Step 1 do Task 3 confirma por `grep` que nada além do lookup usa `onlyDigits`/`normCnpj`/`stringOrUndef`/`focus` em `clientes/actions.ts` antes de apagar.
- **Heurística de erro:** a classificação depende do texto do `Error` do `call()`. Se a Focus mudar o formato da mensagem, cai no genérico "Falha ao consultar CNPJ." (degradação suave, não quebra).
