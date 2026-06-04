# Modelo CNAE + anexo (fundação multi-atividade) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a fundação de dados para multi-atividade — tabelas `cnae_anexo` (referência curada) e `company_cnaes` (relacional), resolução do anexo via `cnae_anexo` com fallback pro `anexo_simples` manual, ingestão dos CNAEs via BrasilAPI (best-effort) — sem mudar o motor de cálculo.

**Architecture:** Migration adiciona as duas tabelas + seed. Uma função pura `resolverAnexo` decide o anexo a partir do CNAE principal (cai no manual quando não mapeado / Fator R). Um helper server `sincronizarCnaesEmpresa` popula `company_cnaes` via BrasilAPI ao criar a empresa, com fallback. A apuração passa a ler o anexo via `resolverAnexo` em vez do campo solto. Degrada graciosamente se a migration não rodou (cai no manual = comportamento atual).

**Tech Stack:** Next.js (server actions), Supabase (Postgres + RLS), TypeScript, Vitest. Spec: `docs/superpowers/specs/2026-06-04-modelo-cnae-anexo-design.md`.

> **Status (2026-06-04):** ✅ Executado na branch `feat/fundacao-cnae-anexo`; migration 0020 aplicada; AL Piscinas verificada (principal `4299501` → Anexo IV). **Desvio do plano:** Tasks 4 e 7 usavam `upsert`/`ON CONFLICT`, mas o índice único de `company_cnaes` é parcial (`WHERE deleted_at IS NULL`) e o Postgres rejeita `ON CONFLICT` contra índice parcial (`42P10`) — o sync passou a usar **full-replace** (delete + insert). Backfill em massa esbarra no rate-limit (403) da BrasilAPI; ver caveat de produção no doc de investigação.

---

## File Structure

- **Create** `app/supabase/migrations/0020_cnae_anexo_company_cnaes.sql` — DDL das 2 tabelas + RLS + seed inicial.
- **Create** `app/src/lib/fiscal/anexo-resolver.ts` — função pura `resolverAnexo`.
- **Create** `app/src/lib/fiscal/anexo-resolver.test.ts` — testes da resolução.
- **Create** `app/src/lib/clients/brasilapi.ts` — client BrasilAPI + mapper.
- **Create** `app/src/lib/clients/brasilapi.test.ts` — teste do mapper.
- **Create** `app/src/lib/fiscal/cnae-sync.ts` — helper server `sincronizarCnaesEmpresa` (best-effort).
- **Create** `app/scripts/backfill-cnaes.mjs` — backfill das empresas existentes.
- **Modify** `app/src/app/(auth)/onboarding/actions.ts` — chamar `sincronizarCnaesEmpresa` no create.
- **Modify** `app/src/app/(auth)/impostos/actions.ts` — ler anexo via `resolverAnexo` em `iniciarApuracaoAction`.
- **Modify** `app/src/app/(auth)/impostos/page.tsx` — idem no dashboard (origem do anexo).

Comandos rodam de `app/`. Migration é aplicada **manualmente** no Supabase (padrão do projeto).

---

## Task 1: Migration 0020 — tabelas + RLS + seed

**Files:**
- Create: `app/supabase/migrations/0020_cnae_anexo_company_cnaes.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- @custom — Fundação multi-atividade: catálogo CNAE→anexo + CNAEs por empresa.
-- Ver docs/superpowers/specs/2026-06-04-modelo-cnae-anexo-design.md.
-- Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a fonte de verdade).

-- 1) Referência global CNAE → anexo (curada; não é dado de tenant).
CREATE TABLE IF NOT EXISTS public.cnae_anexo (
  codigo      TEXT PRIMARY KEY,                         -- 7 dígitos, sem máscara
  anexo_base  TEXT,                                     -- 'Anexo I'..'Anexo V'; NULL = depende de Fator R / desconhecido
  fator_r     BOOLEAN NOT NULL DEFAULT false,           -- sujeito a Fator R (III↔V)
  anexo_iv    BOOLEAN NOT NULL DEFAULT false,           -- flag Anexo IV (INSS à parte) — tratar no futuro
  descricao   TEXT,
  observacao  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cnae_anexo IS 'Referência CNAE→anexo do Simples (curada). anexo_base NULL quando depende de Fator R.';

ALTER TABLE public.cnae_anexo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cnae_anexo_select ON public.cnae_anexo FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Sem policy de escrita: curada via migration (service_role).

-- 2) CNAEs por empresa.
CREATE TABLE IF NOT EXISTS public.company_cnaes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  codigo        TEXT NOT NULL,                           -- 7 dígitos
  descricao     TEXT,
  tipo          TEXT NOT NULL CHECK (tipo IN ('principal','secundario')),
  fonte         TEXT,                                    -- 'brasilapi' | 'focus' | 'manual'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE public.company_cnaes IS 'CNAEs (principal + secundários) por empresa. Anexo é resolvido via cnae_anexo em leitura.';

CREATE UNIQUE INDEX IF NOT EXISTS company_cnaes_company_codigo_uniq
  ON public.company_cnaes (company_id, codigo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS company_cnaes_company_idx ON public.company_cnaes (company_id);

ALTER TABLE public.company_cnaes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY company_cnaes_owner ON public.company_cnaes
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) updated_at automático (mesmo padrão das demais tabelas).
DO $$ BEGIN
  CREATE TRIGGER tg_company_cnaes_updated_at BEFORE UPDATE ON public.company_cnaes
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- 4) Seed inicial (curado à mão — LC 123/CGSN). Crescer conforme aparecem novos CNAEs.
--    Sujeitos a Fator R: fator_r=true, anexo_base=NULL (cai no manual III/V).
INSERT INTO public.cnae_anexo (codigo, anexo_base, fator_r, anexo_iv, descricao) VALUES
  ('4299501', 'Anexo IV', false, true,  'Construção de instalações esportivas e recreativas'),
  ('4120400', 'Anexo IV', false, true,  'Construção de edifícios'),
  ('4322301', 'Anexo IV', false, true,  'Instalações hidráulicas, sanitárias e de gás'),
  ('4744005', 'Anexo I',  false, false, 'Comércio varejista de materiais de construção em geral'),
  ('4744003', 'Anexo I',  false, false, 'Comércio varejista de materiais hidráulicos'),
  ('4789005', 'Anexo I',  false, false, 'Comércio varejista de produtos saneantes domissanitários'),
  ('6201501', NULL,       true,  false, 'Desenvolvimento de programas de computador sob encomenda')
ON CONFLICT (codigo) DO NOTHING;
```

- [ ] **Step 2: Aplicar a migration no Supabase (manual)**

Peça ao usuário para colar o conteúdo de `0020_cnae_anexo_company_cnaes.sql` no SQL Editor do Supabase e executar. (Não há CLI/conexão DDL no ambiente.)

- [ ] **Step 3: Verificar que as tabelas existem**

Run (de `app/`):
```bash
node -e '
const fs=require("fs");const env=fs.readFileSync(".env.local","utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^["\x27]|["\x27]$/g,""):null};
const url=get("NEXT_PUBLIC_SUPABASE_URL"),key=get("SUPABASE_SERVICE_ROLE_KEY"),H={apikey:key,Authorization:`Bearer ${key}`};
(async()=>{
 const a=await (await fetch(`${url}/rest/v1/cnae_anexo?select=codigo,anexo_base,fator_r&limit=10`,{headers:H})).json();
 console.log("cnae_anexo:",JSON.stringify(a));
 const c=await (await fetch(`${url}/rest/v1/company_cnaes?select=id&limit=1`,{headers:H})).json();
 console.log("company_cnaes ok:",Array.isArray(c));
})();'
```
Expected: imprime os 7 CNAEs semeados e `company_cnaes ok: true`.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0020_cnae_anexo_company_cnaes.sql
git commit -m "feat(db): migration 0020 — cnae_anexo + company_cnaes + seed"
```

---

## Task 2: `resolverAnexo` (função pura)

**Files:**
- Create: `app/src/lib/fiscal/anexo-resolver.ts`
- Test: `app/src/lib/fiscal/anexo-resolver.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
import { describe, it, expect } from 'vitest';
import { resolverAnexo } from './anexo-resolver';

describe('resolverAnexo', () => {
  it('CNAE mapeado com anexo_base e sem Fator R → usa o anexo do catálogo', () => {
    const r = resolverAnexo({
      cnaePrincipal: '4744005',
      cnaeAnexo: { codigo: '4744005', anexo_base: 'Anexo I', fator_r: false },
      anexoManual: 'Anexo III',
    });
    expect(r).toEqual({ anexo: 'Anexo I', origem: 'cnae' });
  });

  it('CNAE sujeito a Fator R → cai no manual com aviso', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo III',
    });
    expect(r.anexo).toBe('Anexo III');
    expect(r.origem).toBe('manual');
    expect(r.aviso).toMatch(/Fator R/i);
  });

  it('CNAE não mapeado → cai no manual com aviso', () => {
    const r = resolverAnexo({ cnaePrincipal: '9999999', cnaeAnexo: null, anexoManual: 'Anexo V' });
    expect(r).toEqual({ anexo: 'Anexo V', origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' });
  });

  it('sem CNAE principal → cai no manual com aviso específico', () => {
    const r = resolverAnexo({ cnaePrincipal: null, cnaeAnexo: null, anexoManual: 'Anexo III' });
    expect(r.origem).toBe('manual');
    expect(r.aviso).toMatch(/sem cnae/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/anexo-resolver.test.ts`
Expected: FAIL ("Cannot find module './anexo-resolver'").

- [ ] **Step 3: Implementar**

```ts
import type { AnexoSimples } from './regime';

// Registro de cnae_anexo do CNAE principal (null = não mapeado).
export type CnaeAnexoRef = { codigo: string; anexo_base: AnexoSimples | null; fator_r: boolean } | null;

export type AnexoResolvido = {
  anexo: AnexoSimples | null;
  origem: 'cnae' | 'manual';
  aviso?: string;
};

/**
 * Decide o anexo da apuração a partir do CNAE principal:
 *  - mapeado, anexo_base definido, sem Fator R → usa o catálogo;
 *  - sujeito a Fator R (III↔V indefinido sem cálculo) → cai no manual + aviso;
 *  - não mapeado / sem CNAE → cai no manual + aviso.
 * `anexoManual` é o empresas_fiscais.anexo_simples (override/fallback).
 */
export function resolverAnexo(params: {
  cnaePrincipal: string | null;
  cnaeAnexo: CnaeAnexoRef;
  anexoManual: AnexoSimples | null;
}): AnexoResolvido {
  const { cnaePrincipal, cnaeAnexo, anexoManual } = params;
  if (cnaeAnexo && cnaeAnexo.anexo_base && !cnaeAnexo.fator_r) {
    return { anexo: cnaeAnexo.anexo_base, origem: 'cnae' };
  }
  if (cnaeAnexo && cnaeAnexo.fator_r) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Anexo depende do Fator R — confirmar (III ou V).' };
  }
  if (!cnaePrincipal) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Sem CNAE principal — usando anexo informado.' };
  }
  return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/anexo-resolver.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/anexo-resolver.ts app/src/lib/fiscal/anexo-resolver.test.ts
git commit -m "feat(fiscal): resolverAnexo — anexo por CNAE com fallback manual"
```

---

## Task 3: Client BrasilAPI + mapper

**Files:**
- Create: `app/src/lib/clients/brasilapi.ts`
- Test: `app/src/lib/clients/brasilapi.test.ts`

- [ ] **Step 1: Escrever o teste do mapper (falhando)**

```ts
import { describe, it, expect } from 'vitest';
import { mapBrasilApiCnpj } from './brasilapi';

describe('mapBrasilApiCnpj', () => {
  it('extrai principal + secundários (código string + descrição)', () => {
    const raw = {
      cnae_fiscal: 4299501,
      cnae_fiscal_descricao: 'Construção de instalações esportivas e recreativas',
      cnaes_secundarios: [
        { codigo: 4322301, descricao: 'Instalações hidráulicas, sanitárias e de gás' },
        { codigo: 4120400, descricao: 'Construção de edifícios' },
      ],
    };
    expect(mapBrasilApiCnpj(raw)).toEqual({
      cnaePrincipal: { codigo: '4299501', descricao: 'Construção de instalações esportivas e recreativas' },
      cnaesSecundarios: [
        { codigo: '4322301', descricao: 'Instalações hidráulicas, sanitárias e de gás' },
        { codigo: '4120400', descricao: 'Construção de edifícios' },
      ],
    });
  });

  it('tolera ausência de secundários e descrição', () => {
    expect(mapBrasilApiCnpj({ cnae_fiscal: 4120400 })).toEqual({
      cnaePrincipal: { codigo: '4120400', descricao: null },
      cnaesSecundarios: [],
    });
  });

  it('null/sem cnae_fiscal → principal null', () => {
    expect(mapBrasilApiCnpj({})).toEqual({ cnaePrincipal: null, cnaesSecundarios: [] });
    expect(mapBrasilApiCnpj(null)).toEqual({ cnaePrincipal: null, cnaesSecundarios: [] });
  });

  it('ignora secundário código 0/ausente (BrasilAPI usa 0 quando não há)', () => {
    const raw = { cnae_fiscal: 4120400, cnaes_secundarios: [{ codigo: 0, descricao: '' }] };
    expect(mapBrasilApiCnpj(raw).cnaesSecundarios).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/clients/brasilapi.test.ts`
Expected: FAIL ("Cannot find module './brasilapi'").

- [ ] **Step 3: Implementar**

```ts
import 'server-only';

// Consulta de CNPJ na BrasilAPI (pública). Usada SÓ p/ obter a lista de CNAEs
// (principal + secundários) — a Focus /v2/cnpjs não traz secundários.
export type BrasilApiCnae = { codigo: string; descricao: string | null };
export type BrasilApiCnpj = { cnaePrincipal: BrasilApiCnae | null; cnaesSecundarios: BrasilApiCnae[] };

function codigoStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\D+/g, '');
  return s.length >= 6 && !/^0+$/.test(s) ? s : null; // CNAE tem 7 dígitos; 0 = "não há"
}
function descStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
}

export function mapBrasilApiCnpj(raw: unknown): BrasilApiCnpj {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pCod = codigoStr(o.cnae_fiscal);
  const cnaePrincipal = pCod ? { codigo: pCod, descricao: descStr(o.cnae_fiscal_descricao) } : null;
  const sec = Array.isArray(o.cnaes_secundarios) ? o.cnaes_secundarios : [];
  const cnaesSecundarios: BrasilApiCnae[] = [];
  for (const s of sec) {
    const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const cod = codigoStr(r.codigo);
    if (cod) cnaesSecundarios.push({ codigo: cod, descricao: descStr(r.descricao) });
  }
  return { cnaePrincipal, cnaesSecundarios };
}

/** GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}. null em erro (best-effort). */
export async function consultarCnpjBrasilApi(cnpj: string): Promise<BrasilApiCnpj | null> {
  const d = (cnpj ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return mapBrasilApiCnpj(await res.json());
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/clients/brasilapi.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/clients/brasilapi.ts app/src/lib/clients/brasilapi.test.ts
git commit -m "feat(clients): BrasilAPI — consulta de CNAEs (principal + secundários)"
```

---

## Task 4: Helper `sincronizarCnaesEmpresa` (server, best-effort)

**Files:**
- Create: `app/src/lib/fiscal/cnae-sync.ts`

> Sem teste unitário: é I/O (Supabase + rede), best-effort, e a validação real é o backfill (Task 7) + o uso no create (Task 5). O mapper já está coberto na Task 3.

- [ ] **Step 1: Implementar**

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consultarCnpjBrasilApi } from '@/lib/clients/brasilapi';

/**
 * Popula company_cnaes (principal + secundários) via BrasilAPI. Best-effort:
 * nunca lança. Se a BrasilAPI falhar e houver um cnaePrincipalFallback (ex.: o
 * cnae_principal já conhecido da Focus), grava só o principal (fonte 'focus').
 * Idempotente: upsert por (company_id, codigo).
 */
export async function sincronizarCnaesEmpresa(
  supabase: SupabaseClient,
  params: { companyId: string; ownerUserId: string; cnpj: string; cnaePrincipalFallback?: string | null },
): Promise<void> {
  const { companyId, ownerUserId, cnpj, cnaePrincipalFallback } = params;
  try {
    const data = await consultarCnpjBrasilApi(cnpj);
    const rows: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();

    if (data?.cnaePrincipal) {
      rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: data.cnaePrincipal.codigo,
        descricao: data.cnaePrincipal.descricao, tipo: 'principal', fonte: 'brasilapi', updated_at: now, deleted_at: null });
      for (const s of data.cnaesSecundarios) {
        rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: s.codigo,
          descricao: s.descricao, tipo: 'secundario', fonte: 'brasilapi', updated_at: now, deleted_at: null });
      }
    } else if (cnaePrincipalFallback) {
      const cod = String(cnaePrincipalFallback).replace(/\D+/g, '');
      if (cod) rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: cod,
        descricao: null, tipo: 'principal', fonte: 'focus', updated_at: now, deleted_at: null });
    }

    if (rows.length === 0) return;
    const { error } = await supabase
      .from('company_cnaes')
      .upsert(rows, { onConflict: 'company_id,codigo' });
    if (error) console.warn('[sincronizarCnaesEmpresa]', error.message);
  } catch (e) {
    console.warn('[sincronizarCnaesEmpresa] falhou:', e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: "No errors found".

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/cnae-sync.ts
git commit -m "feat(fiscal): sincronizarCnaesEmpresa — popula company_cnaes via BrasilAPI"
```

---

## Task 5: Chamar a ingestão ao criar a empresa

**Files:**
- Modify: `app/src/app/(auth)/onboarding/actions.ts` (em `createCompanyAction`, após a empresa ser inserida com sucesso e o `id` conhecido)

- [ ] **Step 1: Importar o helper**

No topo de `app/src/app/(auth)/onboarding/actions.ts`, adicionar junto aos imports existentes:
```ts
import { sincronizarCnaesEmpresa } from '@/lib/fiscal/cnae-sync';
```

- [ ] **Step 2: Chamar após o insert da empresa**

Em `createCompanyAction`, logo após obter o `id` da empresa recém-criada (o registro retornado do `.from('companies').insert(...).select(...).single()`), e antes do `return`, adicionar (best-effort — não bloqueia o cadastro):
```ts
  // Popula company_cnaes (principal + secundários) — best-effort, não derruba o cadastro.
  await sincronizarCnaesEmpresa(supabase, {
    companyId: company.id as string,
    ownerUserId: user.id,
    cnpj: (input.cnpj as string) ?? '',
    cnaePrincipalFallback: (input.cnae_principal as string | null) ?? null,
  });
```
> Ajuste os nomes `company`, `user` e `input` para os identificadores reais em uso na função (ver `createCompanyAction` — a empresa inserida e o `user` autenticado). Se o create não tiver o `user` em escopo, use o `owner_user_id` já gravado na empresa.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: "No errors found".

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/onboarding/actions.ts"
git commit -m "feat(onboarding): popular company_cnaes ao criar a empresa"
```

---

## Task 6: Apuração lê o anexo via `resolverAnexo`

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts` (`iniciarApuracaoAction`, perto da linha 100 onde `const anexo = (fiscal.anexo_simples ...)`)
- Modify: `app/src/app/(auth)/impostos/page.tsx` (onde lê `anexo_simples` para o card da competência)

- [ ] **Step 1: Helper de resolução com lookup (server)**

Em `app/src/lib/fiscal/cnae-sync.ts`, adicionar uma função que busca o CNAE principal + o registro de `cnae_anexo` e devolve o `AnexoResolvido`:
```ts
import { resolverAnexo, type AnexoResolvido } from '@/lib/fiscal/anexo-resolver';
import type { AnexoSimples } from '@/lib/fiscal/regime';

/** Resolve o anexo da empresa (CNAE principal → cnae_anexo → fallback manual). Degrada p/ manual se tabelas ausentes. */
export async function resolverAnexoEmpresa(
  supabase: SupabaseClient,
  companyId: string,
  anexoManual: AnexoSimples | null,
): Promise<AnexoResolvido> {
  try {
    const { data: cnae } = await supabase
      .from('company_cnaes')
      .select('codigo')
      .eq('company_id', companyId).eq('tipo', 'principal').is('deleted_at', null)
      .maybeSingle();
    const cnaePrincipal = (cnae?.codigo as string | null) ?? null;
    let ref = null as { codigo: string; anexo_base: AnexoSimples | null; fator_r: boolean } | null;
    if (cnaePrincipal) {
      const { data: a } = await supabase
        .from('cnae_anexo')
        .select('codigo, anexo_base, fator_r')
        .eq('codigo', cnaePrincipal).maybeSingle();
      ref = a ? { codigo: a.codigo as string, anexo_base: (a.anexo_base as AnexoSimples | null) ?? null, fator_r: a.fator_r === true } : null;
    }
    return resolverAnexo({ cnaePrincipal, cnaeAnexo: ref, anexoManual });
  } catch {
    return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
  }
}
```

- [ ] **Step 2: Usar em `iniciarApuracaoAction`**

Em `app/src/app/(auth)/impostos/actions.ts`, importar:
```ts
import { resolverAnexoEmpresa } from '@/lib/fiscal/cnae-sync';
```
Substituir (perto da linha 100):
```ts
  const anexo = (fiscal.anexo_simples ?? null) as AnexoSimples | null;
```
por:
```ts
  const resolvido = await resolverAnexoEmpresa(supabase, companyId, (fiscal.anexo_simples ?? null) as AnexoSimples | null);
  const anexo = resolvido.anexo;
```
O resto da função segue usando `anexo` como hoje (nada muda no cálculo). `resolvido.aviso` fica disponível para a UI (passo 3).

- [ ] **Step 3: Verificar tipos + rodar a suíte fiscal**

Run: `npx tsc --noEmit && npx vitest run src/lib/fiscal`
Expected: tsc "No errors found"; testes PASS (sem regressão).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/fiscal/cnae-sync.ts "app/src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): apuração lê o anexo via resolverAnexo (CNAE→cnae_anexo)"
```

> Nota: expor `resolvido.aviso` na UI (prévia/diagnóstico "anexo assumido — confirmar") é uma melhoria de UX pequena; se o executor quiser, adiciona no `ApuracaoWizard`/preview. Não é bloqueante pra fundação.

---

## Task 7: Backfill das empresas existentes

**Files:**
- Create: `app/scripts/backfill-cnaes.mjs`

- [ ] **Step 1: Escrever o script**

```js
// Backfill de company_cnaes p/ empresas existentes, via BrasilAPI. Best-effort, idempotente.
// Rodar de app/: node scripts/backfill-cnaes.mjs
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const url = get('NEXT_PUBLIC_SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const codigoStr = (v) => { if (v == null) return null; const s = String(v).replace(/\D+/g, ''); return s.length >= 6 && !/^0+$/.test(s) ? s : null; };
const descStr = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s.length ? s : null; };

const companies = await (await fetch(`${url}/rest/v1/companies?select=id,user_id,cnpj&deleted_at=is.null`, { headers: H })).json();
let ok = 0, skip = 0;
for (const c of companies) {
  const cnpj = String(c.cnpj ?? '').replace(/\D+/g, '');
  if (cnpj.length !== 14) { skip++; continue; }
  let data;
  try { const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`); if (!r.ok) { skip++; continue; } data = await r.json(); }
  catch { skip++; continue; }
  const rows = [];
  const pCod = codigoStr(data.cnae_fiscal);
  if (pCod) rows.push({ company_id: c.id, owner_user_id: c.user_id, codigo: pCod, descricao: descStr(data.cnae_fiscal_descricao), tipo: 'principal', fonte: 'brasilapi', deleted_at: null });
  for (const s of (Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios : [])) {
    const cod = codigoStr(s.codigo);
    if (cod) rows.push({ company_id: c.id, owner_user_id: c.user_id, codigo: cod, descricao: descStr(s.descricao), tipo: 'secundario', fonte: 'brasilapi', deleted_at: null });
  }
  if (rows.length === 0) { skip++; continue; }
  const up = await fetch(`${url}/rest/v1/company_cnaes?on_conflict=company_id,codigo`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
  if (up.ok) ok++; else { console.warn('falhou', c.id, await up.text()); skip++; }
  await new Promise((r) => setTimeout(r, 300)); // rate-limit gentil com a BrasilAPI
}
console.log(`backfill: ${ok} empresas populadas, ${skip} puladas`);
```

- [ ] **Step 2: Rodar o backfill (após a migration 0020 aplicada)**

Run (de `app/`): `node scripts/backfill-cnaes.mjs`
Expected: imprime `backfill: N empresas populadas, M puladas` sem erro fatal.

- [ ] **Step 3: Verificar dados (AL Piscinas)**

Run (de `app/`):
```bash
node -e '
const fs=require("fs");const env=fs.readFileSync(".env.local","utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^["\x27]|["\x27]$/g,""):null};
const url=get("NEXT_PUBLIC_SUPABASE_URL"),key=get("SUPABASE_SERVICE_ROLE_KEY"),H={apikey:key,Authorization:`Bearer ${key}`};
fetch(`${url}/rest/v1/company_cnaes?select=codigo,tipo,descricao&company_id=eq.41a9c2a4-241f-40b0-a1c5-da3fced49359`,{headers:H}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,1)));'
```
Expected: lista o principal `4299501` + os 5 secundários da AL Piscinas.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/backfill-cnaes.mjs
git commit -m "chore(scripts): backfill de company_cnaes via BrasilAPI"
```

---

## Self-Review (preenchido)

**Spec coverage:** tabelas `cnae_anexo` + `company_cnaes` (Task 1) ✓; seed inicial (Task 1) ✓; `resolverAnexo` + fallback/aviso (Task 2) ✓; ingestão BrasilAPI + fallback Focus (Tasks 3-5) ✓; apuração lê via resolução, sem mudar cálculo (Task 6) ✓; backfill (Task 7) ✓; degradação graciosa sem a migration (Task 6 try/catch) ✓. Fator R/segregação/CRUD ficam fora (conforme spec).

**Placeholders:** nenhum "TBD/TODO" com lógica pendente; a única nota de adaptação é em Task 5 (nomes de variável de `createCompanyAction`), explicitada.

**Type consistency:** `AnexoResolvido`/`CnaeAnexoRef` definidos na Task 2 e reusados na Task 6; `resolverAnexo`/`resolverAnexoEmpresa`/`sincronizarCnaesEmpresa`/`mapBrasilApiCnpj`/`consultarCnpjBrasilApi` com nomes estáveis entre tarefas; `codigoStr` (≥6 dígitos, exclui 0) repetido de propósito no script de backfill (sem import cruzado de `server-only`).
