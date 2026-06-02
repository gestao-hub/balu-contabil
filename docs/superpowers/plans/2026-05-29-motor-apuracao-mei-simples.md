# Motor de apuração MEI + Simples — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular a apuração mensal de imposto (MEI fixo / Simples Nacional via tabela) a partir das receitas da empresa, persistir em `apuracoes_fiscais` e exibir num wizard com breakdown.

**Architecture:** Núcleo de cálculo puro e testável (`lib/fiscal/`) que consome um tipo normalizado `ReceitaApuracao`, isolado da origem dos dados por uma costura (`receitas-source.ts`). Server action orquestra (auth → empresa → receitas → cálculo → upsert) e um wizard de 2 passos (preview → confirmar) consome a action.

**Tech Stack:** Next.js 15 (App Router, Server Actions, `useActionState`), Supabase, vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-29-motor-apuracao-mei-simples-design.md`

---

## Decisões fixadas (lidas do código real, 2026-05-29)

- **Formato de competência canônico: `YYYYMM`** (6 dígitos, sem hífen). Casa com `competenciaReferenciaBrt`/`competenciaLabel` (`lib/fiscal/guia.ts`) e com o matching da PR 3.1 (`impostos/page.tsx`). Corrige o spec, que dizia `YYYY-MM`.
- **Sem campo de data de início de atividade** em `companies`/`empresas_fiscais`. A anualização do RBT12 é implementada e testada no núcleo (param opcional), mas a action passa `undefined` (sem anualização) até o campo existir.
- **MEI: atividade não é confiável** — `normalizeRegimePatch` zera `anexo_simples` para code 4. A action passa `empresas_fiscais.anexo_simples` se houver, senão o núcleo usa default `Prestacao de Servicos` (foco NFS-e).
- **Regime resolvido** por `profiles.current_company`; `empresas_fiscais` liga por `empresa_id`; regime vem de `Code_regime_tributario` ('1'|'2'|'3'|'4') + `anexo_simples`.

## File Structure

- Create: `src/lib/fiscal/apuracao-types.ts` — tipos `ReceitaApuracao`, `ResultadoApuracao` (a costura).
- Modify: `src/lib/fiscal/guia.ts` — adiciona `competenciaAddMonths` (aritmética de competência, DRY).
- Create: `src/lib/fiscal/simples.ts` — tabela Anexos I–V + `identificarFaixa` + `aliquotaEfetiva`.
- Create: `src/lib/fiscal/rbt12.ts` — `calcularRbt12` (janela de 12 meses + anualização).
- Create: `src/lib/fiscal/das-mei.ts` — `valorDasMei`.
- Create: `src/lib/fiscal/apuracao.ts` — orquestrador `calcularApuracao` + `RegimeNaoSuportadoError`.
- Create: `supabase/migrations/0007_apuracoes_unique.sql` — unique index.
- Create: `src/lib/fiscal/receitas-source.ts` — `lerReceitasParaApuracao` (opção b: notas_fiscais).
- Create: `src/app/(auth)/impostos/actions.ts` — `iniciarApuracaoAction`.
- Create: `src/app/(auth)/impostos/novo/page.tsx` + `novo/ApuracaoWizard.tsx` — wizard.
- Test: `*.test.ts` ao lado de cada módulo puro.

Comandos de referência (rodar de `app/`): `npm run test -- <arquivo>`, `npm run typecheck`.

---

## Task 1: Helper de aritmética de competência

**Files:**
- Modify: `src/lib/fiscal/guia.ts` (adicionar export)
- Test: `src/lib/fiscal/guia.test.ts` (adicionar casos; criar se não existir)

- [ ] **Step 1: Write the failing test**

Adicionar ao `src/lib/fiscal/guia.test.ts` (se o arquivo não existir, criar com o import e o `describe`):

```ts
import { describe, it, expect } from 'vitest';
import { competenciaAddMonths } from './guia';

describe('competenciaAddMonths', () => {
  it('subtrai meses sem virar ano', () => {
    expect(competenciaAddMonths('202605', -1)).toBe('202604');
  });
  it('subtrai virando o ano', () => {
    expect(competenciaAddMonths('202601', -1)).toBe('202512');
  });
  it('subtrai 12 meses', () => {
    expect(competenciaAddMonths('202605', -12)).toBe('202505');
  });
  it('soma virando o ano', () => {
    expect(competenciaAddMonths('202512', 1)).toBe('202601');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fiscal/guia.test.ts`
Expected: FAIL — `competenciaAddMonths is not a function`.

- [ ] **Step 3: Write minimal implementation**

Adicionar ao final de `src/lib/fiscal/guia.ts`:

```ts
/** Soma `delta` meses a uma competência YYYYMM, tratando virada de ano. */
export function competenciaAddMonths(referencia: string, delta: number): string {
  const r = (referencia ?? '').padStart(6, '0');
  const y = Number(r.slice(0, 4));
  const m = Number(r.slice(4, 6));
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}${String(nm).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fiscal/guia.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/guia.ts src/lib/fiscal/guia.test.ts
git commit -m "feat(fiscal): competenciaAddMonths (aritmética de competência YYYYMM)"
```

---

## Task 2: Tipos da apuração (a costura)

**Files:**
- Create: `src/lib/fiscal/apuracao-types.ts`

- [ ] **Step 1: Create the types file**

```ts
// Tipos normalizados da apuração. O núcleo de cálculo consome ReceitaApuracao[]
// e não conhece a origem dos dados (notas_fiscais vs receitas_fiscais).

/** Uma receita já normalizada para apuração. competencia em YYYYMM. */
export type ReceitaApuracao = {
  competencia: string; // "YYYYMM"
  valor: number;       // R$ (receita bruta do documento)
};

export type ResultadoApuracao = {
  tipoApuracao: 'DAS-MEI' | 'Simples Nacional';
  competencia: string;            // "YYYYMM"
  receitaMes: number;             // receita bruta da própria competência
  rbt12: number | null;           // null para MEI
  aliquotaEfetiva: number | null; // null para MEI; fração (0.0433 = 4,33%)
  valorImposto: number;
  breakdown: Record<string, unknown>; // vira payload_calculo
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (sem erros novos).

- [ ] **Step 3: Commit**

```bash
git add src/lib/fiscal/apuracao-types.ts
git commit -m "feat(fiscal): tipos normalizados da apuração (ReceitaApuracao, ResultadoApuracao)"
```

---

## Task 3: Tabela do Simples + faixa + alíquota efetiva

**Files:**
- Create: `src/lib/fiscal/simples.ts`
- Test: `src/lib/fiscal/simples.test.ts`

Valores: LC 123/2006 com redação da LC 155/2016 (Anexos I–V), vigentes em 2026. Conferir contra fonte oficial na implementação (inalterados desde 2018, confiança alta).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { identificarFaixa, aliquotaEfetiva, getTabelaSimples } from './simples';

describe('identificarFaixa', () => {
  it('faixa 1 no limite inferior', () => {
    expect(identificarFaixa(100000, 'Anexo I').faixa).toBe(1);
  });
  it('boundary: exatamente 180000 ainda é faixa 1', () => {
    expect(identificarFaixa(180000, 'Anexo I').faixa).toBe(1);
  });
  it('boundary: 180000.01 vira faixa 2', () => {
    expect(identificarFaixa(180000.01, 'Anexo I').faixa).toBe(2);
  });
  it('acima do teto cai na última faixa (6)', () => {
    expect(identificarFaixa(99_000_000, 'Anexo III').faixa).toBe(6);
  });
});

describe('aliquotaEfetiva', () => {
  it('faixa 1 sem dedução = nominal', () => {
    const faixa = identificarFaixa(100000, 'Anexo I'); // 4%
    expect(aliquotaEfetiva(100000, faixa)).toBeCloseTo(0.04, 4);
  });
  it('Anexo I faixa 2: RBT12 200k → 4,33%', () => {
    const faixa = identificarFaixa(200000, 'Anexo I'); // 7,3% / 5940
    expect(aliquotaEfetiva(200000, faixa)).toBeCloseTo(0.0433, 3);
  });
  it('clamp: nunca negativa', () => {
    const faixa = { faixa: 2, ate: 360000, nominal: 0.073, deduzir: 999999 };
    expect(aliquotaEfetiva(200000, faixa)).toBe(0);
  });
  it('rbt12 = 0 → alíquota 0 (sem divisão por zero)', () => {
    const faixa = identificarFaixa(0, 'Anexo I');
    expect(aliquotaEfetiva(0, faixa)).toBe(0);
  });
});

describe('getTabelaSimples', () => {
  it('Anexo III faixa 1 = 6%', () => {
    expect(getTabelaSimples('202601')['Anexo III'][0].nominal).toBe(0.06);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fiscal/simples.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AnexoSimples } from './regime';

export type FaixaSimples = { faixa: number; ate: number; nominal: number; deduzir: number };

// LC 123/2006 (redação LC 155/2016). nominal em fração; ate/deduzir em R$.
const TABELA_SIMPLES_2026: Record<AnexoSimples, FaixaSimples[]> = {
  'Anexo I': [
    { faixa: 1, ate: 180000, nominal: 0.04, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.073, deduzir: 5940 },
    { faixa: 3, ate: 720000, nominal: 0.095, deduzir: 13860 },
    { faixa: 4, ate: 1800000, nominal: 0.107, deduzir: 22500 },
    { faixa: 5, ate: 3600000, nominal: 0.143, deduzir: 87300 },
    { faixa: 6, ate: 4800000, nominal: 0.19, deduzir: 378000 },
  ],
  'Anexo II': [
    { faixa: 1, ate: 180000, nominal: 0.045, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.078, deduzir: 5940 },
    { faixa: 3, ate: 720000, nominal: 0.10, deduzir: 13860 },
    { faixa: 4, ate: 1800000, nominal: 0.112, deduzir: 22500 },
    { faixa: 5, ate: 3600000, nominal: 0.147, deduzir: 85500 },
    { faixa: 6, ate: 4800000, nominal: 0.30, deduzir: 720000 },
  ],
  'Anexo III': [
    { faixa: 1, ate: 180000, nominal: 0.06, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.112, deduzir: 9360 },
    { faixa: 3, ate: 720000, nominal: 0.135, deduzir: 17640 },
    { faixa: 4, ate: 1800000, nominal: 0.16, deduzir: 35640 },
    { faixa: 5, ate: 3600000, nominal: 0.21, deduzir: 125640 },
    { faixa: 6, ate: 4800000, nominal: 0.33, deduzir: 648000 },
  ],
  'Anexo IV': [
    { faixa: 1, ate: 180000, nominal: 0.045, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.09, deduzir: 8100 },
    { faixa: 3, ate: 720000, nominal: 0.102, deduzir: 12420 },
    { faixa: 4, ate: 1800000, nominal: 0.14, deduzir: 39780 },
    { faixa: 5, ate: 3600000, nominal: 0.22, deduzir: 183780 },
    { faixa: 6, ate: 4800000, nominal: 0.33, deduzir: 828000 },
  ],
  'Anexo V': [
    { faixa: 1, ate: 180000, nominal: 0.155, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.18, deduzir: 4500 },
    { faixa: 3, ate: 720000, nominal: 0.195, deduzir: 9900 },
    { faixa: 4, ate: 1800000, nominal: 0.205, deduzir: 17100 },
    { faixa: 5, ate: 3600000, nominal: 0.23, deduzir: 62100 },
    { faixa: 6, ate: 4800000, nominal: 0.305, deduzir: 540000 },
  ],
};

/** Retorna a tabela vigente para a competência. Hoje só 2026; versionar quando entrar LC 214/2025. */
export function getTabelaSimples(_competencia: string): Record<AnexoSimples, FaixaSimples[]> {
  return TABELA_SIMPLES_2026;
}

/** Primeira faixa cujo teto cobre o RBT12; acima do teto, última faixa. */
export function identificarFaixa(rbt12: number, anexo: AnexoSimples, competencia = '202601'): FaixaSimples {
  const tabela = getTabelaSimples(competencia)[anexo];
  return tabela.find((f) => rbt12 <= f.ate) ?? tabela[tabela.length - 1];
}

/** Alíquota efetiva = ((RBT12 * nominal) - dedução) / RBT12, com clamp em 0. */
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (rbt12 <= 0) return 0;
  return Math.max(0, (rbt12 * faixa.nominal - faixa.deduzir) / rbt12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fiscal/simples.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/simples.ts src/lib/fiscal/simples.test.ts
git commit -m "feat(fiscal): tabela Simples (Anexos I-V) + identificarFaixa + aliquotaEfetiva com clamp"
```

---

## Task 4: RBT12 com janela de 12 meses + anualização

**Files:**
- Create: `src/lib/fiscal/rbt12.ts`
- Test: `src/lib/fiscal/rbt12.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { calcularRbt12 } from './rbt12';
import type { ReceitaApuracao } from './apuracao-types';

const mk = (comp: string, valor: number): ReceitaApuracao => ({ competencia: comp, valor });

describe('calcularRbt12', () => {
  it('exclui a competência atual da janela (Bug 2)', () => {
    const receitas = [mk('202505', 1000), mk('202506', 9999)]; // 202506 = competência atual
    const { rbt12 } = calcularRbt12(receitas, '202506');
    expect(rbt12).toBe(1000); // 9999 da competência atual NÃO entra
  });
  it('janela = 12 meses anteriores, virando o ano', () => {
    const receitas = [
      mk('202412', 100), // entra (jan/2025 apura dez/2024..jan? não: 202501 apura 202401..202412)
      mk('202401', 50),  // entra
      mk('202312', 999), // fora (antes da janela)
    ];
    const { rbt12 } = calcularRbt12(receitas, '202501');
    expect(rbt12).toBe(150);
  });
  it('12 meses cheios não anualiza', () => {
    const receitas = Array.from({ length: 12 }, (_, i) =>
      mk(`2024${String(i + 1).padStart(2, '0')}`, 1000),
    );
    const r = calcularRbt12(receitas, '202501');
    expect(r.rbt12).toBe(12000);
    expect(r.anualizado).toBe(false);
  });
  it('< 12 meses de atividade anualiza proporcionalmente', () => {
    // início em 202411; competência 202501 → janela 202401..202412; meses ativos = nov+dez = 2
    const receitas = [mk('202411', 1000), mk('202412', 1000)];
    const r = calcularRbt12(receitas, '202501', '2024-11-15');
    expect(r.mesesConsiderados).toBe(2);
    expect(r.anualizado).toBe(true);
    expect(r.rbt12).toBe(12000); // 2000 * 12 / 2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fiscal/rbt12.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ReceitaApuracao } from './apuracao-types';
import { competenciaAddMonths } from './guia';

function compIndex(comp: string): number {
  const r = comp.padStart(6, '0');
  return Number(r.slice(0, 4)) * 12 + (Number(r.slice(4, 6)) - 1);
}

/**
 * RBT12 = receita bruta dos 12 meses imediatamente anteriores à competência
 * (exclui a própria competência). Anualiza se a empresa tem < 12 meses de atividade.
 */
export function calcularRbt12(
  receitas: ReceitaApuracao[],
  competencia: string,
  dataInicioAtividade?: string,
): { rbt12: number; mesesConsiderados: number; anualizado: boolean } {
  const inicio = competenciaAddMonths(competencia, -12); // 12 meses antes
  const fim = competenciaAddMonths(competencia, -1);      // mês anterior (exclui a atual)
  const somaReal = receitas
    .filter((r) => r.competencia >= inicio && r.competencia <= fim)
    .reduce((acc, r) => acc + r.valor, 0);

  let mesesConsiderados = 12;
  if (dataInicioAtividade) {
    const d = new Date(dataInicioAtividade);
    const inicioAtivIdx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const startIdx = Math.max(compIndex(inicio), inicioAtivIdx);
    const endIdx = compIndex(fim);
    mesesConsiderados = Math.min(12, Math.max(1, endIdx - startIdx + 1));
  }

  const anualizado = mesesConsiderados < 12;
  const rbt12 = anualizado ? (somaReal * 12) / mesesConsiderados : somaReal;
  return { rbt12: Number(rbt12.toFixed(2)), mesesConsiderados, anualizado };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fiscal/rbt12.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/rbt12.ts src/lib/fiscal/rbt12.test.ts
git commit -m "feat(fiscal): calcularRbt12 (janela 12m exclui competência atual + anualização)"
```

---

## Task 5: DAS-MEI (valores fixos)

**Files:**
- Create: `src/lib/fiscal/das-mei.ts`
- Test: `src/lib/fiscal/das-mei.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { valorDasMei } from './das-mei';

describe('valorDasMei', () => {
  it('comércio ou indústria', () => {
    expect(valorDasMei('Comercio ou Industria')).toBe(76.90);
  });
  it('prestação de serviços', () => {
    expect(valorDasMei('Prestacao de Servicos')).toBe(80.90);
  });
  it('comércio e serviços', () => {
    expect(valorDasMei('Comercio e Servicos')).toBe(81.90);
  });
  it('desconhecido/null → default serviços', () => {
    expect(valorDasMei(null)).toBe(80.90);
    expect(valorDasMei('xpto')).toBe(80.90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fiscal/das-mei.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// DAS-MEI: INSS 5% do salário mínimo + ICMS (R$1) e/ou ISS (R$5).
// Base: salário mínimo R$ 1.518 (2025) → INSS R$ 75,90.
// CONFERIR e atualizar quando o salário mínimo de 2026 for oficial.
const DAS_MEI_2026 = {
  'Comercio ou Industria': 76.90, // 75,90 + 1,00 ICMS
  'Prestacao de Servicos': 80.90, // 75,90 + 5,00 ISS
  'Comercio e Servicos': 81.90,   // 75,90 + 1,00 + 5,00
} as const;

export function valorDasMei(atividade: string | null | undefined): number {
  if (atividade && atividade in DAS_MEI_2026) {
    return DAS_MEI_2026[atividade as keyof typeof DAS_MEI_2026];
  }
  return DAS_MEI_2026['Prestacao de Servicos'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fiscal/das-mei.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/das-mei.ts src/lib/fiscal/das-mei.test.ts
git commit -m "feat(fiscal): valorDasMei (valores fixos DAS-MEI 2026)"
```

---

## Task 6: Orquestrador `calcularApuracao`

**Files:**
- Create: `src/lib/fiscal/apuracao.ts`
- Test: `src/lib/fiscal/apuracao.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { calcularApuracao, RegimeNaoSuportadoError } from './apuracao';
import type { ReceitaApuracao } from './apuracao-types';

const mk = (comp: string, valor: number): ReceitaApuracao => ({ competencia: comp, valor });

describe('calcularApuracao', () => {
  it('MEI: valor fixo, rbt12/alíquota null, receita do mês somada', () => {
    const r = calcularApuracao({
      regimeCode: '4', anexo: null, competencia: '202506',
      receitas: [mk('202506', 5000)], atividadeMei: 'Prestacao de Servicos',
    });
    expect(r.tipoApuracao).toBe('DAS-MEI');
    expect(r.valorImposto).toBe(80.90);
    expect(r.rbt12).toBeNull();
    expect(r.receitaMes).toBe(5000);
  });

  it('Simples: receita do mês * alíquota efetiva (Bug 1 corrigido)', () => {
    // RBT12 = 200000 (12 meses anteriores), Anexo I faixa 2 → ~4,33%
    const anteriores = Array.from({ length: 12 }, (_, i) =>
      mk(competenciaBack('202506', i + 1), 200000 / 12),
    );
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202506',
      receitas: [...anteriores, mk('202506', 10000)],
    });
    expect(r.tipoApuracao).toBe('Simples Nacional');
    expect(r.rbt12).toBeCloseTo(200000, 0);
    expect(r.aliquotaEfetiva).toBeCloseTo(0.0433, 3);
    expect(r.receitaMes).toBe(10000);
    expect(r.valorImposto).toBeCloseTo(10000 * 0.0433, 0);
  });

  it('regime Normal (code 3) lança RegimeNaoSuportadoError', () => {
    expect(() =>
      calcularApuracao({ regimeCode: '3', anexo: null, competencia: '202506', receitas: [] }),
    ).toThrow(RegimeNaoSuportadoError);
  });

  it('receitas vazias: Simples → imposto 0', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo III', competencia: '202506', receitas: [],
    });
    expect(r.receitaMes).toBe(0);
    expect(r.valorImposto).toBe(0);
  });
});

// helper local do teste: volta `n` meses de uma competência YYYYMM
function competenciaBack(comp: string, n: number): string {
  const y = Number(comp.slice(0, 4));
  const m = Number(comp.slice(4, 6));
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/fiscal/apuracao.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AnexoSimples } from './regime';
import type { ReceitaApuracao, ResultadoApuracao } from './apuracao-types';
import { identificarFaixa, aliquotaEfetiva } from './simples';
import { calcularRbt12 } from './rbt12';
import { valorDasMei } from './das-mei';

export class RegimeNaoSuportadoError extends Error {
  constructor(public readonly code: string) {
    super('Regime Normal (Lucro Real/Presumido) não é apurado na v1. Fale com o contador.');
    this.name = 'RegimeNaoSuportadoError';
  }
}

export function calcularApuracao(input: {
  regimeCode: string;
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;
  atividadeMei?: string | null;
  dataInicioAtividade?: string;
}): ResultadoApuracao {
  const { regimeCode, anexo, receitas, competencia } = input;
  const receitaMes = Number(
    receitas
      .filter((r) => r.competencia === competencia)
      .reduce((acc, r) => acc + r.valor, 0)
      .toFixed(2),
  );

  if (regimeCode === '4') {
    const valorImposto = valorDasMei(input.atividadeMei);
    return {
      tipoApuracao: 'DAS-MEI',
      competencia,
      receitaMes,
      rbt12: null,
      aliquotaEfetiva: null,
      valorImposto,
      breakdown: { tipo: 'DAS-MEI', atividade: input.atividadeMei ?? null, valorFixo: valorImposto },
    };
  }

  if (regimeCode === '1' || regimeCode === '2') {
    if (!anexo) throw new Error('Anexo do Simples não informado para apuração.');
    const { rbt12, mesesConsiderados, anualizado } = calcularRbt12(
      receitas, competencia, input.dataInicioAtividade,
    );
    const faixa = identificarFaixa(rbt12, anexo, competencia);
    const aliquota = aliquotaEfetiva(rbt12, faixa);
    const valorImposto = Number((receitaMes * aliquota).toFixed(2));
    return {
      tipoApuracao: 'Simples Nacional',
      competencia,
      receitaMes,
      rbt12,
      aliquotaEfetiva: Number(aliquota.toFixed(4)),
      valorImposto,
      breakdown: {
        tipo: 'Simples Nacional', anexo, rbt12, mesesConsiderados, anualizado,
        faixa: faixa.faixa, aliquotaNominal: faixa.nominal, parcelaDeduzir: faixa.deduzir,
        aliquotaEfetiva: Number(aliquota.toFixed(4)), receitaMes, valorImposto,
      },
    };
  }

  throw new RegimeNaoSuportadoError(regimeCode);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/fiscal/apuracao.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/apuracao.ts src/lib/fiscal/apuracao.test.ts
git commit -m "feat(fiscal): orquestrador calcularApuracao (MEI/Simples, bloqueia regime Normal)"
```

---

## Task 7: Migration — unique index em apuracoes_fiscais

**Files:**
- Create: `supabase/migrations/0007_apuracoes_unique.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Impede apuração duplicada por empresa+competência (corrige Bugs 5 e 6 do fluxo n8n).
-- Habilita upsert idempotente em iniciarApuracaoAction.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_apuracoes_company_competencia
  ON public.apuracoes_fiscais (company_id, competencia_referencia)
  WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Aplicar no Supabase**

Aplicar via SQL Editor do Supabase (ou `supabase db push` se o CLI estiver linkado). Confirmar criação:

Run (SQL Editor): `select indexname from pg_indexes where indexname = 'uniq_apuracoes_company_competencia';`
Expected: 1 linha.

> Nota: se já houver duplicatas em `apuracoes_fiscais`, a criação do índice falha. Resolver removendo/soft-deletando duplicatas antes (`competencia_referencia` repetida por `company_id`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_apuracoes_unique.sql
git commit -m "feat(db): unique index apuracoes (company_id, competencia_referencia)"
```

---

## Task 8: Costura de dados — `lerReceitasParaApuracao` (opção b provisória)

**Files:**
- Create: `src/lib/fiscal/receitas-source.ts`

- [ ] **Step 1: Create the module**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import { competenciaAddMonths } from './guia';

/**
 * Lê as receitas necessárias para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 *
 * PROVISÓRIO (2026-05-29): implementa a OPÇÃO (b) — lê de `notas_fiscais`.
 * A tabela `receitas_fiscais` é órfã (ninguém a popula) e foi esvaziada sem backup.
 * Decisão final pendente do outro dev. Se virar opção (a), trocar SÓ o corpo desta função.
 */
export async function lerReceitasParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<ReceitaApuracao[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)
  const inicioIso = `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-01T00:00:00`;

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('data_emissao, valor_total, status, tipo_documento')
    .eq('company_id', companyId)
    .eq('status', 'ativa')
    .gte('data_emissao', inicioIso);

  if (error) throw new Error(`Falha ao ler notas para apuração: ${error.message}`);

  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => {
      const d = new Date(n.data_emissao as string);
      const competencia = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return { competencia, valor: Number(n.valor_total) };
    });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fiscal/receitas-source.ts
git commit -m "feat(fiscal): lerReceitasParaApuracao (costura, opção b provisória sobre notas_fiscais)"
```

---

## Task 9: Server action `iniciarApuracaoAction`

**Files:**
- Create: `src/app/(auth)/impostos/actions.ts`

Padrão de resolução de empresa copiado de `notas_fiscais/actions.ts` (auth → `profiles.current_company`).

- [ ] **Step 1: Create the action**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { AnexoSimples } from '@/lib/fiscal/regime';
import type { ResultadoApuracao } from '@/lib/fiscal/apuracao-types';
import { calcularApuracao, RegimeNaoSuportadoError } from '@/lib/fiscal/apuracao';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';

export type ApuracaoResult =
  | { ok: true; resultado: ResultadoApuracao }
  | { ok: false; error: string };

/**
 * Calcula a apuração de uma competência. modo='preview' só calcula; modo='commit' persiste.
 * competencia em YYYYMM.
 */
export async function iniciarApuracaoAction(
  competencia: string,
  modo: 'preview' | 'commit' = 'preview',
): Promise<ApuracaoResult> {
  if (!/^\d{6}$/.test(competencia)) {
    return { ok: false, error: 'Competência inválida (esperado YYYYMM).' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };

  const regimeCode = (fiscal.Code_regime_tributario ?? '') as string;
  const anexo = (fiscal.anexo_simples ?? null) as AnexoSimples | null;

  let resultado: ResultadoApuracao;
  try {
    const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
    resultado = calcularApuracao({
      regimeCode, anexo, receitas, competencia,
      atividadeMei: fiscal.anexo_simples, // null p/ MEI → núcleo usa default serviços
      // dataInicioAtividade: não temos o campo no schema → sem anualização por ora
    });
  } catch (e) {
    if (e instanceof RegimeNaoSuportadoError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao calcular apuração.' };
  }

  if (modo === 'preview') return { ok: true, resultado };

  const { error: upErr } = await supabase
    .from('apuracoes_fiscais')
    .upsert(
      {
        company_id: companyId,
        owner_user_id: user.id,
        competencia_referencia: resultado.competencia,
        tipo_apuracao: resultado.tipoApuracao,
        anexo_simples: anexo,
        receita_mes: resultado.receitaMes,
        rbt12: resultado.rbt12,
        aliquota_efetiva: resultado.aliquotaEfetiva,
        valor_imposto: resultado.valorImposto,
        status: 'calculada',
        payload_calculo: resultado.breakdown,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,competencia_referencia' },
    );
  if (upErr) return { ok: false, error: `Falha ao salvar apuração: ${upErr.message}` };

  revalidatePath('/impostos');
  return { ok: true, resultado };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS. (Se o import `@/lib/supabase/server` divergir, conferir o nome real do export em `src/lib/supabase/server.ts` e ajustar.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): iniciarApuracaoAction (preview/commit, upsert idempotente)"
```

---

## Task 10: Wizard `/impostos/novo`

**Files:**
- Create: `src/app/(auth)/impostos/novo/page.tsx`
- Create: `src/app/(auth)/impostos/novo/ApuracaoWizard.tsx`

- [ ] **Step 1: Create the page (server)**

`src/app/(auth)/impostos/novo/page.tsx`:

```tsx
import { competenciaReferenciaBrt, competenciaAddMonths } from '@/lib/fiscal/guia';
import ApuracaoWizard from './ApuracaoWizard';

export default function NovaApuracaoPage() {
  const competenciaDefault = competenciaAddMonths(competenciaReferenciaBrt(new Date()), -1);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900">Nova apuração</h1>
      <ApuracaoWizard competenciaDefault={competenciaDefault} />
    </div>
  );
}
```

- [ ] **Step 2: Create the wizard (client)**

`src/app/(auth)/impostos/novo/ApuracaoWizard.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { iniciarApuracaoAction, type ApuracaoResult } from '../actions';
import { competenciaLabel, brl } from '@/lib/fiscal/guia';

export default function ApuracaoWizard({ competenciaDefault }: { competenciaDefault: string }) {
  const router = useRouter();
  const [competencia, setCompetencia] = useState(competenciaDefault);
  const [preview, setPreview] = useState<Extract<ApuracaoResult, { ok: true }>['resultado'] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function calcular() {
    setErro(null);
    startTransition(async () => {
      const r = await iniciarApuracaoAction(competencia, 'preview');
      if (r.ok) { setPreview(r.resultado); } else { setErro(r.error); setPreview(null); }
    });
  }

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r = await iniciarApuracaoAction(competencia, 'commit');
      if (r.ok) { router.push('/impostos'); } else { setErro(r.error); }
    });
  }

  return (
    <div className="space-y-6">
      {/* Passo 1: competência */}
      <div className="rounded-lg border border-zinc-200 p-4">
        <label className="block text-sm font-medium text-zinc-700">Competência (YYYYMM)</label>
        <input
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="mt-1 w-40 rounded border border-zinc-300 px-3 py-2 font-mono"
          inputMode="numeric"
        />
        <p className="mt-1 text-xs text-zinc-500">{competenciaLabel(competencia)}</p>
        <button
          onClick={calcular}
          disabled={pending || competencia.length !== 6}
          className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* Passo 2: preview + confirmar */}
      {preview && (
        <div className="rounded-lg border border-zinc-200 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-800">{preview.tipoApuracao}</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-zinc-500">Receita do mês</dt><dd className="text-right">{brl(preview.receitaMes)}</dd>
            {preview.rbt12 != null && (<><dt className="text-zinc-500">RBT12</dt><dd className="text-right">{brl(preview.rbt12)}</dd></>)}
            {preview.aliquotaEfetiva != null && (<><dt className="text-zinc-500">Alíquota efetiva</dt><dd className="text-right">{(preview.aliquotaEfetiva * 100).toFixed(2)}%</dd></>)}
            <dt className="font-medium text-zinc-700">Imposto</dt><dd className="text-right font-semibold">{brl(preview.valorImposto)}</dd>
          </dl>
          <button
            onClick={confirmar}
            disabled={pending}
            className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Salvando…' : 'Confirmar apuração'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke (runtime)**

Subir o app (`npm run dev`), logar, ir em `/impostos/novo`, calcular a competência default e confirmar. Verificar que a apuração aparece em `/impostos`. (Depende de `.env.local` com Supabase real.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/impostos/novo/page.tsx" "src/app/(auth)/impostos/novo/ApuracaoWizard.tsx"
git commit -m "feat(impostos): wizard de nova apuração (preview → confirmar)"
```

---

## Self-review (preenchido)

**Spec coverage:** simples.ts (T3), rbt12.ts (T4), das-mei.ts (T5), migration UNIQUE (T7), orquestrador (T6), action (T9), wizard (T10), costura a/b (T8), tipos (T2), helper competência (T1). Todos os itens 1–7 do spec cobertos. Serpro (8–9) fora de escopo, conforme combinado.

**Bugs do n8n:** Bug 1 (receitaMes correto, T6), Bug 2 (janela 12m, T4), Bug 3 (clamp, T3), Bug 4 (bloqueio regime Normal, T6), Bugs 5/6 (unique + upsert, T7/T9), Limitação 1 (anualização no núcleo, T4 — não acionada na action por falta de campo, documentado).

**Limitações conhecidas (documentadas no código):** sem anualização real (falta campo de início de atividade); MEI sempre default serviços (anexo_simples zerado p/ MEI); valores DAS-MEI a confirmar com salário mínimo 2026; costura lê notas_fiscais (provisório).

**Type consistency:** `ReceitaApuracao`/`ResultadoApuracao` (T2) usados consistentemente em T4/T6/T8/T9. `competenciaAddMonths` (T1) usado em T4/T8/T10. `AnexoSimples` reusado de `regime.ts`. Formato YYYYMM consistente em todos os módulos.
