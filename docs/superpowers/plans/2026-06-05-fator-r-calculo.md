# Fator R — Cálculo e Decisão de Anexo (III↔V) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular o Fator R (folha ÷ RBT12) e cravar Anexo III ou V na apuração, com a folha mantida numa tela dedicada.

**Architecture:** Tabela `folha_mensal` (1 reg/mês, 3 componentes) alimenta uma camada pura (`somarFolha12`, `calcularFatorR`) que pluga no `resolverAnexo`/`resolverAnexoEmpresa` já existente. A apuração passa a receber a competência e persiste o `%` em `apuracoes_fiscais.fator_r`. Uma tela `/impostos/folha` mantém a folha em lote.

**Tech Stack:** Next.js App Router (server actions, server/client components), Supabase (Postgres + RLS), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-fator-r-calculo-design.md`

---

## File Structure

- `app/supabase/migrations/0022_folha_mensal.sql` — nova tabela (aditiva/idempotente).
- `app/src/types/database.ts` — tipo `folha_mensal`.
- `app/src/lib/fiscal/folha.ts` (+ `.test.ts`) — `FolhaMensal`, `somarFolha12` (puro).
- `app/src/lib/fiscal/fator-r.ts` (+ `.test.ts`) — `calcularFatorR` (puro).
- `app/src/lib/fiscal/anexo-resolver.ts` (+ `.test.ts`) — param `fatorR`, `origem:'fator_r'`.
- `app/src/lib/fiscal/folha-source.ts` — `lerFolhaParaApuracao` (I/O).
- `app/src/lib/fiscal/cnae-sync.ts` — `resolverAnexoEmpresa(..., competencia)`.
- `app/src/app/(auth)/impostos/actions.ts` — competência + grava `fator_r` + `salvarFolhaAction`.
- `app/src/app/(auth)/impostos/folha/page.tsx` + `FolhaGrid.tsx` — tela de folha.
- `app/src/app/(auth)/impostos/page.tsx` — link de entrada.

---

### Task 1: Migração `folha_mensal` + tipo

**Files:**
- Create: `app/supabase/migrations/0022_folha_mensal.sql`
- Modify: `app/src/types/database.ts`

- [ ] **Step 1: Escrever a migration**

Create `app/supabase/migrations/0022_folha_mensal.sql`:

```sql
-- @custom — Fator R: folha mensal por empresa (pró-labore + salários + encargos).
-- Ver docs/superpowers/specs/2026-06-05-fator-r-calculo-design.md.
-- Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a fonte de verdade).
-- Sem deleted_at de propósito: folha de um mês é valor que se corrige, não registro que se
-- apaga. Assim o UNIQUE é real (não índice parcial) e o upsert por (company_id, competencia)
-- funciona direto, sem o erro 42P10 dos índices parciais.

CREATE TABLE IF NOT EXISTS public.folha_mensal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  competencia   TEXT NOT NULL,                 -- YYYYMM
  pro_labore    NUMERIC(14,2) NOT NULL DEFAULT 0,
  salarios      NUMERIC(14,2) NOT NULL DEFAULT 0,
  encargos      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT folha_mensal_company_competencia_uniq UNIQUE (company_id, competencia)
);
COMMENT ON TABLE public.folha_mensal IS 'Folha mensal por empresa (pró-labore+salários+encargos). Alimenta o Fator R (Anexo III↔V).';

CREATE INDEX IF NOT EXISTS folha_mensal_company_idx ON public.folha_mensal (company_id);

ALTER TABLE public.folha_mensal ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY folha_mensal_owner ON public.folha_mensal
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER tg_folha_mensal_updated_at BEFORE UPDATE ON public.folha_mensal
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Adicionar o tipo em `database.ts`**

Em `app/src/types/database.ts`, ao lado de `company_cnaes`, adicionar (ajustar a vírgula conforme a posição):

```ts
      folha_mensal: {
        Row: {
          id: string;
          company_id: string;
          owner_user_id: string;
          competencia: string;
          pro_labore: number;
          salarios: number;
          encargos: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          owner_user_id: string;
          competencia: string;
          pro_labore?: number;
          salarios?: number;
          encargos?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          owner_user_id?: string;
          competencia?: string;
          pro_labore?: number;
          salarios?: number;
          encargos?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
```

- [ ] **Step 3: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0022_folha_mensal.sql app/src/types/database.ts
git commit -m "feat(fiscal): tabela folha_mensal (Fator R) + tipo"
```

> **NOTA AO EXECUTOR:** a migration é aplicada manualmente pelo usuário (padrão do projeto — `db_atual.sql` é a fonte de verdade). Não tente rodar `supabase db push`.

---

### Task 2: `somarFolha12` (puro, TDD)

**Files:**
- Create: `app/src/lib/fiscal/folha.ts`
- Test: `app/src/lib/fiscal/folha.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/folha.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { somarFolha12, type FolhaMensal } from './folha';

const f = (competencia: string, proLabore: number, salarios = 0, encargos = 0): FolhaMensal => ({
  competencia, proLabore, salarios, encargos,
});

describe('somarFolha12', () => {
  it('soma os 12 meses anteriores e exclui a própria competência', () => {
    const folhas = [
      f('202505', 1000),  // dentro da janela (mês anterior a 202506)
      f('202406', 2000),  // limite inferior (12 meses antes)
      f('202405', 9999),  // fora (13 meses antes)
      f('202506', 5000),  // a própria competência — excluída
    ];
    const r = somarFolha12(folhas, '202506');
    expect(r.folha12m).toBe(3000); // 1000 + 2000
    expect(r.meses).toBe(2);
  });

  it('soma os três componentes do mês', () => {
    const r = somarFolha12([f('202505', 1000, 500, 200)], '202506');
    expect(r.folha12m).toBe(1700);
    expect(r.meses).toBe(1);
  });

  it('retorna zero quando não há folha na janela', () => {
    const r = somarFolha12([], '202506');
    expect(r.folha12m).toBe(0);
    expect(r.meses).toBe(0);
  });

  it('não conta meses com soma zero em "meses"', () => {
    const r = somarFolha12([f('202505', 0, 0, 0), f('202504', 100)], '202506');
    expect(r.folha12m).toBe(100);
    expect(r.meses).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/folha.test.ts`
Expected: FAIL ("Cannot find module './folha'").

- [ ] **Step 3: Implementar `folha.ts`**

Create `app/src/lib/fiscal/folha.ts`:

```ts
import { competenciaAddMonths } from './guia';

export type FolhaMensal = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

/**
 * Soma a folha (pró-labore + salários + encargos) dos 12 meses imediatamente anteriores à
 * competência (exclui a própria), mesma janela do RBT12. `meses` = competências com soma > 0.
 */
export function somarFolha12(
  folhas: FolhaMensal[],
  competencia: string,
): { folha12m: number; meses: number } {
  const inicio = competenciaAddMonths(competencia, -12);
  const fim = competenciaAddMonths(competencia, -1);
  let folha12m = 0;
  let meses = 0;
  for (const item of folhas) {
    if (item.competencia < inicio || item.competencia > fim) continue;
    const total = item.proLabore + item.salarios + item.encargos;
    folha12m += total;
    if (total > 0) meses += 1;
  }
  return { folha12m: Number(folha12m.toFixed(2)), meses };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/folha.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/folha.ts app/src/lib/fiscal/folha.test.ts
git commit -m "feat(fiscal): somarFolha12 (janela de 12 meses para Fator R)"
```

---

### Task 3: `calcularFatorR` (puro, TDD)

**Files:**
- Create: `app/src/lib/fiscal/fator-r.ts`
- Test: `app/src/lib/fiscal/fator-r.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/fator-r.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularFatorR, LIMIAR_FATOR_R } from './fator-r';

describe('calcularFatorR', () => {
  it('>= 28% decide Anexo III', () => {
    const r = calcularFatorR({ folha12m: 3000, rbt12: 10000 }); // 30%
    expect(r.suficiente).toBe(true);
    expect(r.fatorR).toBeCloseTo(0.3, 5);
    expect(r.anexoDecidido).toBe('Anexo III');
  });

  it('< 28% decide Anexo V', () => {
    const r = calcularFatorR({ folha12m: 2000, rbt12: 10000 }); // 20%
    expect(r.suficiente).toBe(true);
    expect(r.anexoDecidido).toBe('Anexo V');
  });

  it('exatamente 28% decide Anexo III (fronteira inclusiva)', () => {
    const r = calcularFatorR({ folha12m: 2800, rbt12: 10000 }); // 28%
    expect(r.fatorR).toBeCloseTo(LIMIAR_FATOR_R, 5);
    expect(r.anexoDecidido).toBe('Anexo III');
  });

  it('rbt12 = 0 → insuficiente', () => {
    const r = calcularFatorR({ folha12m: 3000, rbt12: 0 });
    expect(r.suficiente).toBe(false);
    expect(r.fatorR).toBeNull();
    expect(r.anexoDecidido).toBeNull();
  });

  it('folha = 0 → insuficiente', () => {
    const r = calcularFatorR({ folha12m: 0, rbt12: 10000 });
    expect(r.suficiente).toBe(false);
    expect(r.anexoDecidido).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/fator-r.test.ts`
Expected: FAIL ("Cannot find module './fator-r'").

- [ ] **Step 3: Implementar `fator-r.ts`**

Create `app/src/lib/fiscal/fator-r.ts`:

```ts
export const LIMIAR_FATOR_R = 0.28;

export type FatorRResult = {
  fatorR: number | null;                          // razão 0..1 (null se insuficiente)
  anexoDecidido: 'Anexo III' | 'Anexo V' | null;
  suficiente: boolean;
};

/**
 * Fator R = folha (12m) ÷ RBT12. >= 28% → Anexo III, senão Anexo V.
 * Insuficiente (não decide) quando rbt12 <= 0 ou folha12m <= 0 — o chamador cai no manual.
 */
export function calcularFatorR(input: { folha12m: number; rbt12: number }): FatorRResult {
  const { folha12m, rbt12 } = input;
  if (rbt12 <= 0 || folha12m <= 0) {
    return { fatorR: null, anexoDecidido: null, suficiente: false };
  }
  const fatorR = folha12m / rbt12;
  const anexoDecidido = fatorR >= LIMIAR_FATOR_R ? 'Anexo III' : 'Anexo V';
  return { fatorR, anexoDecidido, suficiente: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/fator-r.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/fator-r.ts app/src/lib/fiscal/fator-r.test.ts
git commit -m "feat(fiscal): calcularFatorR (decide Anexo III↔V a 28%)"
```

---

### Task 4: `resolverAnexo` aceita Fator R (TDD)

**Files:**
- Modify: `app/src/lib/fiscal/anexo-resolver.ts`
- Test: `app/src/lib/fiscal/anexo-resolver.test.ts` (criar se não existir; senão adicionar os casos)

- [ ] **Step 1: Escrever o teste (falhando)**

Create/append `app/src/lib/fiscal/anexo-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverAnexo } from './anexo-resolver';
import type { FatorRResult } from './fator-r';

const sufIII: FatorRResult = { fatorR: 0.31, anexoDecidido: 'Anexo III', suficiente: true };
const insuf: FatorRResult = { fatorR: null, anexoDecidido: null, suficiente: false };

describe('resolverAnexo', () => {
  it('CNAE mapeado sem Fator R usa o catálogo', () => {
    const r = resolverAnexo({
      cnaePrincipal: '4744005',
      cnaeAnexo: { codigo: '4744005', anexo_base: 'Anexo I', fator_r: false },
      anexoManual: 'Anexo III',
    });
    expect(r.anexo).toBe('Anexo I');
    expect(r.origem).toBe('cnae');
  });

  it('Fator R suficiente crava o anexo decidido com % no aviso', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo V',
      fatorR: sufIII,
    });
    expect(r.anexo).toBe('Anexo III');
    expect(r.origem).toBe('fator_r');
    expect(r.fatorR).toBeCloseTo(0.31, 5);
    expect(r.aviso).toContain('31.0%');
  });

  it('Fator R insuficiente cai no manual pedindo a folha', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo V',
      fatorR: insuf,
    });
    expect(r.anexo).toBe('Anexo V');
    expect(r.origem).toBe('manual');
    expect(r.aviso).toContain('folha');
  });

  it('Fator R sem dado (undefined) mantém o comportamento atual (manual)', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo III',
    });
    expect(r.origem).toBe('manual');
  });

  it('sem CNAE cai no manual', () => {
    const r = resolverAnexo({ cnaePrincipal: null, cnaeAnexo: null, anexoManual: 'Anexo III' });
    expect(r.origem).toBe('manual');
    expect(r.anexo).toBe('Anexo III');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/anexo-resolver.test.ts`
Expected: FAIL (campo `fatorR` não existe no tipo / `origem 'fator_r'` não retornado).

- [ ] **Step 3: Implementar a mudança em `anexo-resolver.ts`**

Substituir o conteúdo de `app/src/lib/fiscal/anexo-resolver.ts` por:

```ts
import type { AnexoSimples } from './regime';
import type { FatorRResult } from './fator-r';

// Registro de cnae_anexo do CNAE principal (null = não mapeado).
export type CnaeAnexoRef = { codigo: string; anexo_base: AnexoSimples | null; fator_r: boolean } | null;

export type AnexoResolvido = {
  anexo: AnexoSimples | null;
  origem: 'cnae' | 'manual' | 'fator_r';
  fatorR?: number | null;
  aviso?: string;
};

/**
 * Decide o anexo da apuração a partir do CNAE principal:
 *  - mapeado, anexo_base definido, sem Fator R → usa o catálogo;
 *  - sujeito a Fator R + cálculo suficiente → crava III ou V (origem 'fator_r');
 *  - sujeito a Fator R sem cálculo → cai no manual + aviso pedindo a folha;
 *  - não mapeado / sem CNAE → cai no manual + aviso.
 * `anexoManual` é o empresas_fiscais.anexo_simples (override/fallback).
 */
export function resolverAnexo(params: {
  cnaePrincipal: string | null;
  cnaeAnexo: CnaeAnexoRef;
  anexoManual: AnexoSimples | null;
  fatorR?: FatorRResult | null;
}): AnexoResolvido {
  const { cnaePrincipal, cnaeAnexo, anexoManual, fatorR } = params;
  if (cnaeAnexo && cnaeAnexo.anexo_base && !cnaeAnexo.fator_r) {
    return { anexo: cnaeAnexo.anexo_base, origem: 'cnae' };
  }
  if (cnaeAnexo && cnaeAnexo.fator_r) {
    if (fatorR && fatorR.suficiente && fatorR.anexoDecidido) {
      return {
        anexo: fatorR.anexoDecidido,
        origem: 'fator_r',
        fatorR: fatorR.fatorR,
        aviso: `Fator R = ${((fatorR.fatorR ?? 0) * 100).toFixed(1)}% → ${fatorR.anexoDecidido}.`,
      };
    }
    return {
      anexo: anexoManual,
      origem: 'manual',
      aviso: 'Informe a folha dos últimos 12 meses para calcular o Fator R (Anexo III ou V).',
    };
  }
  if (!cnaePrincipal) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Sem CNAE principal — usando anexo informado.' };
  }
  return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/anexo-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/anexo-resolver.ts app/src/lib/fiscal/anexo-resolver.test.ts
git commit -m "feat(fiscal): resolverAnexo aceita Fator R (origem 'fator_r')"
```

---

### Task 5: `lerFolhaParaApuracao` (I/O)

**Files:**
- Create: `app/src/lib/fiscal/folha-source.ts`

- [ ] **Step 1: Implementar `folha-source.ts`**

Create `app/src/lib/fiscal/folha-source.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FolhaMensal } from './folha';
import { competenciaAddMonths } from './guia';

/**
 * Lê a folha necessária para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 * Espelha receitas-source.ts: janela de 13 meses por competência. RLS garante o tenant.
 */
export async function lerFolhaParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<FolhaMensal[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)

  const { data, error } = await supabase
    .from('folha_mensal')
    .select('competencia, pro_labore, salarios, encargos')
    .eq('company_id', companyId)
    .gte('competencia', inicio)
    .lte('competencia', ateCompetencia);

  if (error) throw new Error(`Falha ao ler folha para apuração: ${error.message}`);

  return (data ?? []).map((r) => ({
    competencia: r.competencia as string,
    proLabore: Number(r.pro_labore ?? 0),
    salarios: Number(r.salarios ?? 0),
    encargos: Number(r.encargos ?? 0),
  }));
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/folha-source.ts
git commit -m "feat(fiscal): lerFolhaParaApuracao (janela de 13 meses)"
```

---

### Task 6: `resolverAnexoEmpresa` calcula o Fator R

**Files:**
- Modify: `app/src/lib/fiscal/cnae-sync.ts`

- [ ] **Step 1: Atualizar imports no topo de `cnae-sync.ts`**

Logo abaixo do import de `consultarCnpjBrasilApi`, adicionar:

```ts
import { calcularRbt12 } from '@/lib/fiscal/rbt12';
import { somarFolha12 } from '@/lib/fiscal/folha';
import { calcularFatorR } from '@/lib/fiscal/fator-r';
import { lerFolhaParaApuracao } from '@/lib/fiscal/folha-source';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';
```

- [ ] **Step 2: Reescrever `resolverAnexoEmpresa`**

Substituir a função `resolverAnexoEmpresa` (linhas ~104-129) por:

```ts
export async function resolverAnexoEmpresa(
  supabase: SupabaseClient,
  companyId: string,
  anexoManual: AnexoSimples | null,
  competencia?: string,
): Promise<AnexoResolvido> {
  try {
    const { data: cnae } = await supabase
      .from('company_cnaes')
      .select('codigo')
      .eq('company_id', companyId).eq('tipo', 'principal').is('deleted_at', null)
      .maybeSingle();
    const cnaePrincipal = (cnae?.codigo as string | null) ?? null;
    let ref: CnaeAnexoRef = null;
    if (cnaePrincipal) {
      const { data: a } = await supabase
        .from('cnae_anexo')
        .select('codigo, anexo_base, fator_r')
        .eq('codigo', cnaePrincipal).maybeSingle();
      ref = a ? { codigo: a.codigo as string, anexo_base: (a.anexo_base as AnexoSimples | null) ?? null, fator_r: a.fator_r === true } : null;
    }

    // Só calcula o Fator R quando o CNAE depende dele E a competência foi informada.
    let fatorR = null;
    if (ref?.fator_r && competencia) {
      const [folhas, receitas] = await Promise.all([
        lerFolhaParaApuracao(supabase, companyId, competencia),
        lerReceitasParaApuracao(supabase, companyId, competencia),
      ]);
      const { folha12m } = somarFolha12(folhas, competencia);
      const { rbt12 } = calcularRbt12(receitas, competencia);
      fatorR = calcularFatorR({ folha12m, rbt12 });
    }

    return resolverAnexo({ cnaePrincipal, cnaeAnexo: ref, anexoManual, fatorR });
  } catch (e) {
    console.warn('[resolverAnexoEmpresa]', e instanceof Error ? e.message : String(e));
    return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
  }
}
```

- [ ] **Step 3: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/fiscal/cnae-sync.ts
git commit -m "feat(fiscal): resolverAnexoEmpresa calcula Fator R por competência"
```

---

### Task 7: Apuração passa competência + grava `fator_r` + `salvarFolhaAction`

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`

- [ ] **Step 1: Passar a competência ao resolver e gravar `fator_r`**

Em `iniciarApuracaoAction`, na linha que chama `resolverAnexoEmpresa`, passar a competência:

```ts
  const resolvido = await resolverAnexoEmpresa(supabase, companyId, (fiscal.anexo_simples ?? null) as AnexoSimples | null, competencia);
  const anexo = resolvido.anexo;
```

E no `upsert` de `apuracoes_fiscais` (modo commit), adicionar o campo `fator_r` logo após `rbt12`:

```ts
      rbt12: resultado.rbt12,
      fator_r: resolvido.fatorR ?? null,
```

- [ ] **Step 2: Adicionar a `salvarFolhaAction` ao final do arquivo**

No fim de `app/src/app/(auth)/impostos/actions.ts`, adicionar:

```ts
export type SalvarFolhaResult = { ok: true } | { ok: false; error: string };

export type FolhaInput = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

/**
 * Upsert da folha mensal (lote) da empresa ativa. Usado pela tela /impostos/folha.
 * UNIQUE(company_id, competencia) → onConflict direto (sem soft-delete).
 */
export async function salvarFolhaAction(rows: FolhaInput[]): Promise<SalvarFolhaResult> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
  for (const r of rows) {
    if (!/^\d{6}$/.test(r.competencia)) return { ok: false, error: `Competência inválida: ${r.competencia}.` };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia: r.competencia,
    pro_labore: Number.isFinite(r.proLabore) ? r.proLabore : 0,
    salarios: Number.isFinite(r.salarios) ? r.salarios : 0,
    encargos: Number.isFinite(r.encargos) ? r.encargos : 0,
    updated_at: now,
  }));

  const { error } = await supabase
    .from('folha_mensal')
    .upsert(payload, { onConflict: 'company_id,competencia' });
  if (error) return { ok: false, error: `Falha ao salvar a folha: ${error.message}` };

  revalidatePath('/impostos/folha');
  revalidatePath('/impostos');
  return { ok: true };
}
```

- [ ] **Step 3: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): apuração grava Fator R + salvarFolhaAction"
```

---

### Task 8: Tela `/impostos/folha` + link de entrada

**Files:**
- Create: `app/src/app/(auth)/impostos/folha/page.tsx`
- Create: `app/src/app/(auth)/impostos/folha/FolhaGrid.tsx`
- Modify: `app/src/app/(auth)/impostos/page.tsx`

- [ ] **Step 1: `page.tsx` (server) — carrega as 13 competências**

Create `app/src/app/(auth)/impostos/folha/page.tsx`:

```tsx
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaAddMonths, competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { FolhaGrid, type FolhaRow } from './FolhaGrid';

export const dynamic = 'force-dynamic';

export default async function FolhaPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from('profiles').select('current_company').eq('user_id', user.id).single()
    : { data: null };
  const companyId = (profile?.current_company ?? null) as string | null;

  // 13 competências: a atual + 12 anteriores (mais recente primeiro).
  const atual = competenciaReferenciaBrt(new Date());
  const competencias = Array.from({ length: 13 }, (_, i) => competenciaAddMonths(atual, -i));

  const folhaPorComp = new Map<string, { pro_labore: number; salarios: number; encargos: number }>();
  if (companyId) {
    const inicio = competencias[competencias.length - 1];
    const { data } = await supabase
      .from('folha_mensal')
      .select('competencia, pro_labore, salarios, encargos')
      .eq('company_id', companyId)
      .gte('competencia', inicio)
      .lte('competencia', atual);
    for (const r of data ?? []) {
      folhaPorComp.set(r.competencia as string, {
        pro_labore: Number(r.pro_labore ?? 0),
        salarios: Number(r.salarios ?? 0),
        encargos: Number(r.encargos ?? 0),
      });
    }
  }

  const rows: FolhaRow[] = competencias.map((competencia) => {
    const f = folhaPorComp.get(competencia);
    return {
      competencia,
      proLabore: f?.pro_labore ?? 0,
      salarios: f?.salarios ?? 0,
      encargos: f?.encargos ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/impostos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Link>

      <h1 className="mt-3 text-xl font-semibold">Folha (Fator R)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A folha dos últimos 12 meses alimenta o <strong>Fator R</strong>, que decide entre o
        Anexo III e o Anexo V para CNAEs sujeitos a ele. Meses em branco contam como zero.
      </p>

      {!companyId ? (
        <p className="mt-6 text-sm text-muted-foreground">Selecione uma empresa para lançar a folha.</p>
      ) : (
        <FolhaGrid initialRows={rows} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: `FolhaGrid.tsx` (client) — grade + salvar em lote**

Create `app/src/app/(auth)/impostos/folha/FolhaGrid.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { salvarFolhaAction, type FolhaInput } from '../actions';

export type FolhaRow = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

function rotulo(competencia: string): string {
  return `${competencia.slice(4, 6)}/${competencia.slice(0, 4)}`;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function FolhaGrid({ initialRows }: { initialRows: FolhaRow[] }) {
  const [rows, setRows] = useState<FolhaRow[]>(initialRows);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  function setCampo(idx: number, campo: keyof Omit<FolhaRow, 'competencia'>, valor: string) {
    const num = valor === '' ? 0 : Number(valor);
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [campo]: Number.isFinite(num) ? num : 0 } : r)));
  }

  function salvar() {
    setMsg(null);
    const payload: FolhaInput[] = rows.map((r) => ({
      competencia: r.competencia,
      proLabore: r.proLabore,
      salarios: r.salarios,
      encargos: r.encargos,
    }));
    startTransition(async () => {
      const res = await salvarFolhaAction(payload);
      setMsg(res.ok ? { tipo: 'ok', texto: 'Folha salva.' } : { tipo: 'erro', texto: res.error });
    });
  }

  return (
    <div className="mt-6">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 font-medium">Pró-labore</th>
              <th className="px-3 py-2 font-medium">Salários</th>
              <th className="px-3 py-2 font-medium">Encargos</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const total = r.proLabore + r.salarios + r.encargos;
              return (
                <tr key={r.competencia} className="border-t">
                  <td className="px-3 py-2">{rotulo(r.competencia)}</td>
                  {(['proLabore', 'salarios', 'encargos'] as const).map((campo) => (
                    <td key={campo} className="px-2 py-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={r[campo] === 0 ? '' : r[campo]}
                        placeholder="0,00"
                        onChange={(e) => setCampo(idx, campo, e.target.value)}
                        className="w-28 rounded border px-2 py-1 text-right"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{brl(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        {msg && (
          <span className={msg.tipo === 'ok' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link de entrada em `/impostos`**

Em `app/src/app/(auth)/impostos/page.tsx`, adicionar um link para a folha perto do topo do conteúdo (ajustar ao layout existente — procure o cabeçalho da página e insira logo após o título):

```tsx
import Link from 'next/link';
// ...
<Link
  href="/impostos/folha"
  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
>
  Folha (Fator R)
</Link>
```

> **NOTA AO EXECUTOR:** leia `app/src/app/(auth)/impostos/page.tsx` antes de editar para encaixar o link no layout real (não invente a estrutura). Se já houver um `import Link` no arquivo, não duplicar.

- [ ] **Step 4: Verificar build de tipos e lint**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/impostos/folha/page.tsx" "app/src/app/(auth)/impostos/folha/FolhaGrid.tsx" "app/src/app/(auth)/impostos/page.tsx"
git commit -m "feat(impostos): tela /impostos/folha (grade de folha p/ Fator R)"
```

---

## Self-Review

- **Spec coverage:** folha_mensal (T1) ✓; somarFolha12 (T2) ✓; calcularFatorR (T3) ✓; resolverAnexo+fatorR (T4) ✓; lerFolhaParaApuracao (T5) ✓; resolverAnexoEmpresa competência (T6) ✓; apuração grava fator_r + salvarFolhaAction (T7) ✓; tela /impostos/folha + link (T8) ✓. Segregação fora de escopo (spec) — sem task, correto.
- **Type consistency:** `FatorRResult` (fator-r.ts) usado em anexo-resolver.ts e cnae-sync.ts; `FolhaMensal` (folha.ts) usado em folha-source.ts; `FolhaInput` (actions.ts) usado em FolhaGrid.tsx; `AnexoResolvido.fatorR`/`origem:'fator_r'` consistentes entre T4 e T7. `competenciaAddMonths`/`competenciaReferenciaBrt` já existem em `guia.ts` (usados por rbt12.ts/receitas-source.ts).
- **Placeholders:** nenhum — todo passo tem código real. T8/Step 3 pede leitura do arquivo real porque o layout de `impostos/page.tsx` não foi transcrito (encaixe visual), mas o snippet do link é completo.
