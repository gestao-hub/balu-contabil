# /impostos — Fila de Obrigações + Detalhe por Competência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a `/impostos` (Simples) numa fila de obrigações por estado (a_declarar / a_pagar / vencida) + prévia do mês corrente + histórico, com um detalhe por competência em `/impostos/[competencia]`, aposentando o card único de "competência atual".

**Architecture:** O estado de cada competência é **derivado** das tabelas existentes (`declaracoes_fiscais`, `guias_fiscais`, `apuracoes_fiscais`) por um helper puro `lib/fiscal/obrigacoes.ts` — sem schema novo. A `page.tsx` e a rota de detalhe consomem o mesmo helper. Componentes de apresentação pequenos e focados.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase, TypeScript, Tailwind, Vitest. Spec: `docs/superpowers/specs/2026-06-08-impostos-fila-obrigacoes-design.md`.

**Working dir:** `/home/allan/Projetos/claude/balu/app` (o app Next vive em `app/`; rode `npx`/`git` daqui).

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/lib/fiscal/obrigacoes.ts` | Create | helper puro: tipos + `competenciasEsperadasDoAno` + `derivarObrigacoes` + `ordenarFila` |
| `src/lib/fiscal/obrigacoes.test.ts` | Create | unit tests do helper (núcleo) |
| `src/app/(auth)/impostos/ObrigacaoItem.tsx` | Create | um item da fila: badge + valor + vencimento + ação + link |
| `src/app/(auth)/impostos/FilaObrigacoes.tsx` | Create | recebe obrigações em atenção, ordena, renderiza itens (ou empty state) |
| `src/app/(auth)/impostos/PreviaMesCorrente.tsx` | Create | bloco discreto da estimativa do mês corrente |
| `src/app/(auth)/impostos/SecaoApuracao.tsx` | Create | dl da apuração + "por anexo" (migra do card atual) |
| `src/app/(auth)/impostos/SecaoDeclaracao.tsx` | Create | número/data/status ou ação Transmitir (dry-run) |
| `src/app/(auth)/impostos/SecaoDas.tsx` | Create | valores + datas + Baixar PDF (reusa GuiaActions) |
| `src/app/(auth)/impostos/[competencia]/page.tsx` | Create | rota de detalhe por competência |
| `src/app/(auth)/impostos/page.tsx` | Modify | gera esperadas, deriva, separa atenção × paga, renderiza prévia + fila + histórico |
| `src/app/(auth)/impostos/CompetenciaAtualCard.tsx` | Delete | aposentado (peças migraram p/ SecaoApuracao/SecaoDas) |

---

## Task 1: Helper puro `obrigacoes.ts` — tipos + enumeração de competências

**Files:**
- Create: `src/lib/fiscal/obrigacoes.ts`
- Test: `src/lib/fiscal/obrigacoes.test.ts`

- [ ] **Step 1: Escrever o teste de `competenciasEsperadasDoAno` (falhando)**

Criar `src/lib/fiscal/obrigacoes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { competenciasEsperadasDoAno } from './obrigacoes';

describe('competenciasEsperadasDoAno', () => {
  it('de janeiro até o último mês FECHADO (mês corrente - 1)', () => {
    // 2026-06-08 BRT → mês corrente 202606 → esperadas jan..mai
    const hoje = new Date('2026-06-08T12:00:00-03:00');
    expect(competenciasEsperadasDoAno(hoje)).toEqual([
      '202601', '202602', '202603', '202604', '202605',
    ]);
  });
  it('em janeiro não há mês fechado no ano → vazio', () => {
    const hoje = new Date('2026-01-10T12:00:00-03:00');
    expect(competenciasEsperadasDoAno(hoje)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: FAIL — "competenciasEsperadasDoAno is not a function" / módulo não existe.

- [ ] **Step 3: Implementar `obrigacoes.ts` (tipos + enumeração)**

Criar `src/lib/fiscal/obrigacoes.ts`:

```ts
// @custom — Modelo derivado de obrigações fiscais (Simples). Puro/testável — sem I/O.
// O estado de cada competência é função das tabelas declaracoes_fiscais/guias_fiscais/apuracoes_fiscais.
import { competenciaReferenciaBrt } from './guia';

export type EstadoObrigacao = 'a_declarar' | 'a_pagar' | 'vencida' | 'paga';

export type DeclaracaoInput = {
  competencia: string;            // 'YYYYMM'
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;
};
export type GuiaInput = {
  competencia: string;            // 'YYYYMM'
  numeroDas: string | null;
  valor: number | null;
  vencimento: string | null;      // 'YYYY-MM-DD'
  pagamento: string | null;       // 'YYYY-MM-DD'
  status: string | null;
  pdfUrl: string | null;
};
export type ApuracaoInput = {
  competencia: string;            // 'YYYYMM'
  estimativa: number | null;
};

export type ObrigacaoFiscal = {
  competencia: string;
  estado: EstadoObrigacao;
  declarada: boolean;
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;
  numeroDas: string | null;
  valor: number | null;
  vencimento: string | null;
  pagamento: string | null;
  pdfUrl: string | null;
  estimativaLocal: number | null;
};

/** Competências esperadas: de janeiro do ano corrente até o último mês FECHADO (mês corrente - 1). */
export function competenciasEsperadasDoAno(hoje: Date): string[] {
  const atual = competenciaReferenciaBrt(hoje); // 'YYYYMM'
  const ano = atual.slice(0, 4);
  const mesAtual = Number(atual.slice(4, 6));
  const out: string[] = [];
  for (let m = 1; m < mesAtual; m++) out.push(`${ano}${String(m).padStart(2, '0')}`);
  return out;
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/obrigacoes.ts app/src/lib/fiscal/obrigacoes.test.ts
git commit -m "feat(impostos): obrigacoes.ts — tipos + competenciasEsperadasDoAno (TDD)"
```

---

## Task 2: `derivarObrigacoes` — regra de estado

**Files:**
- Modify: `src/lib/fiscal/obrigacoes.ts`
- Test: `src/lib/fiscal/obrigacoes.test.ts`

- [ ] **Step 1: Escrever os testes de `derivarObrigacoes` (falhando)**

Adicionar ao fim de `src/lib/fiscal/obrigacoes.test.ts`:

```ts
import { derivarObrigacoes } from './obrigacoes';

const HOJE = new Date('2026-06-08T12:00:00-03:00'); // 2026-06-08 BRT
const ESPERADAS = ['202601', '202602', '202603', '202604', '202605'];

function rodar(over: {
  declaracoes?: Parameters<typeof derivarObrigacoes>[0]['declaracoes'];
  guias?: Parameters<typeof derivarObrigacoes>[0]['guias'];
  apuracoes?: Parameters<typeof derivarObrigacoes>[0]['apuracoes'];
} = {}) {
  return derivarObrigacoes({
    hoje: HOJE,
    competenciasEsperadas: ESPERADAS,
    declaracoes: over.declaracoes ?? [],
    guias: over.guias ?? [],
    apuracoes: over.apuracoes ?? [],
  });
}

function estadoDe(comp: string, lista: ReturnType<typeof derivarObrigacoes>) {
  return lista.find((o) => o.competencia === comp)?.estado;
}

describe('derivarObrigacoes — regra de estado', () => {
  it('esperada sem declaração → a_declarar (faz "maio" aparecer)', () => {
    const r = rodar();
    expect(estadoDe('202605', r)).toBe('a_declarar');
    expect(r).toHaveLength(5); // jan..mai todas presentes
  });

  it('guia paga (status) → paga', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202601', numeroDeclaracao: 'D1', dataTransmissao: '2026-02-23T00:00:00Z' }],
      guias: [{ competencia: '202601', numeroDas: 'X', valor: 100, vencimento: '2026-02-20', pagamento: null, status: 'paga', pdfUrl: null }],
    });
    expect(estadoDe('202601', r)).toBe('paga');
  });

  it('guia com data_pagamento (sem status paga) → paga', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202602', numeroDeclaracao: 'D2', dataTransmissao: null }],
      guias: [{ competencia: '202602', numeroDas: 'X', valor: 100, vencimento: '2026-03-20', pagamento: '2026-03-20', status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202602', r)).toBe('paga');
  });

  it('declarada, não paga, vencimento < hoje → vencida', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202604', numeroDeclaracao: 'D4', dataTransmissao: null }],
      guias: [{ competencia: '202604', numeroDas: 'X', valor: 100, vencimento: '2026-05-20', pagamento: null, status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202604', r)).toBe('vencida');
  });

  it('declarada, não paga, vencimento >= hoje → a_pagar', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202605', numeroDeclaracao: 'D5', dataTransmissao: null }],
      guias: [{ competencia: '202605', numeroDas: 'X', valor: 100, vencimento: '2026-06-20', pagamento: null, status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202605', r)).toBe('a_pagar');
  });

  it('declarada, não paga, sem DAS materializado (sem vencimento) → a_pagar', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202605', numeroDeclaracao: 'D5', dataTransmissao: null }],
    });
    expect(estadoDe('202605', r)).toBe('a_pagar');
  });

  it('estimativaLocal vem da apuração comitada', () => {
    const r = rodar({ apuracoes: [{ competencia: '202605', estimativa: 1910.5 }] });
    expect(r.find((o) => o.competencia === '202605')?.estimativaLocal).toBe(1910.5);
  });
});
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: FAIL — "derivarObrigacoes is not a function".

- [ ] **Step 3: Implementar `derivarObrigacoes`**

Adicionar ao fim de `src/lib/fiscal/obrigacoes.ts`:

```ts
/** 'YYYY-MM-DD' de uma Date em BRT. */
function ymdBrt(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function venceuAntesDe(vencimento: string | null, hojeYmd: string): boolean {
  if (!vencimento) return false;
  const v = vencimento.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < hojeYmd;
}

export function derivarObrigacoes(input: {
  hoje: Date;
  competenciasEsperadas: string[];
  declaracoes: DeclaracaoInput[];
  guias: GuiaInput[];
  apuracoes: ApuracaoInput[];
}): ObrigacaoFiscal[] {
  const { hoje, competenciasEsperadas, declaracoes, guias, apuracoes } = input;
  const hojeYmd = ymdBrt(hoje);
  const decByComp = new Map(declaracoes.map((d) => [d.competencia, d]));
  const guiaByComp = new Map(guias.map((g) => [g.competencia, g]));
  const apByComp = new Map(apuracoes.map((a) => [a.competencia, a]));

  // União: esperadas + qualquer competência que já tem declaração/guia (defensivo).
  const comps = new Set<string>(competenciasEsperadas);
  for (const d of declaracoes) comps.add(d.competencia);
  for (const g of guias) comps.add(g.competencia);

  const out: ObrigacaoFiscal[] = [];
  for (const competencia of comps) {
    const d = decByComp.get(competencia) ?? null;
    const g = guiaByComp.get(competencia) ?? null;
    const a = apByComp.get(competencia) ?? null;
    const declarada = !!d?.numeroDeclaracao;
    const paga = (g?.status ?? '').toLowerCase() === 'paga' || !!g?.pagamento;

    let estado: EstadoObrigacao;
    if (paga) estado = 'paga';
    else if (venceuAntesDe(g?.vencimento ?? null, hojeYmd)) estado = 'vencida';
    else if (declarada) estado = 'a_pagar';
    else estado = 'a_declarar';

    out.push({
      competencia,
      estado,
      declarada,
      numeroDeclaracao: d?.numeroDeclaracao ?? null,
      dataTransmissao: d?.dataTransmissao ?? null,
      numeroDas: g?.numeroDas ?? null,
      valor: g?.valor ?? null,
      vencimento: g?.vencimento ?? null,
      pagamento: g?.pagamento ?? null,
      pdfUrl: g?.pdfUrl ?? null,
      estimativaLocal: a?.estimativa ?? null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/obrigacoes.ts app/src/lib/fiscal/obrigacoes.test.ts
git commit -m "feat(impostos): derivarObrigacoes — regra de estado (TDD)"
```

---

## Task 3: `ordenarFila` — ordenação da fila

**Files:**
- Modify: `src/lib/fiscal/obrigacoes.ts`
- Test: `src/lib/fiscal/obrigacoes.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar ao fim de `src/lib/fiscal/obrigacoes.test.ts`:

```ts
import { ordenarFila } from './obrigacoes';

describe('ordenarFila', () => {
  it('vencida → a_pagar → a_declarar; dentro do grupo por competência asc', () => {
    const r = rodar({
      declaracoes: [
        { competencia: '202604', numeroDeclaracao: 'D4', dataTransmissao: null },
        { competencia: '202603', numeroDeclaracao: 'D3', dataTransmissao: null },
      ],
      guias: [
        { competencia: '202604', numeroDas: 'X', valor: 1, vencimento: '2026-05-20', pagamento: null, status: 'gerada', pdfUrl: null }, // vencida
        { competencia: '202603', numeroDas: 'Y', valor: 1, vencimento: '2026-06-20', pagamento: null, status: 'gerada', pdfUrl: null }, // a_pagar
      ],
    });
    // atenção = tudo que não é paga
    const fila = ordenarFila(r.filter((o) => o.estado !== 'paga'));
    expect(fila.map((o) => `${o.competencia}:${o.estado}`)).toEqual([
      '202604:vencida',
      '202603:a_pagar',
      '202601:a_declarar',
      '202602:a_declarar',
      '202605:a_declarar',
    ]);
  });
});
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: FAIL — "ordenarFila is not a function".

- [ ] **Step 3: Implementar `ordenarFila`**

Adicionar ao fim de `src/lib/fiscal/obrigacoes.ts`:

```ts
const PESO_ESTADO: Record<EstadoObrigacao, number> = {
  vencida: 0,
  a_pagar: 1,
  a_declarar: 2,
  paga: 3,
};

/** Ordena a fila: vencida → a_pagar → a_declarar; dentro do grupo, competência ascendente. */
export function ordenarFila(obrigacoes: ObrigacaoFiscal[]): ObrigacaoFiscal[] {
  return [...obrigacoes].sort((a, b) => {
    const pe = PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado];
    if (pe !== 0) return pe;
    return a.competencia.localeCompare(b.competencia);
  });
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/obrigacoes.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/obrigacoes.ts app/src/lib/fiscal/obrigacoes.test.ts
git commit -m "feat(impostos): ordenarFila (TDD)"
```

---

## Task 4: `ObrigacaoItem` + `FilaObrigacoes` (componentes da fila)

**Files:**
- Create: `src/app/(auth)/impostos/ObrigacaoItem.tsx`
- Create: `src/app/(auth)/impostos/FilaObrigacoes.tsx`

Componentes server (sem interação client além de `<Link>`). Badge por estado, valor/estimativa, vencimento, ação primária e link pro detalhe.

- [ ] **Step 1: Criar `ObrigacaoItem.tsx`**

```tsx
// @custom — Um item da fila de obrigações. Server component (só Link).
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { brl, dataBR, competenciaLabel } from '@/lib/fiscal/guia';
import type { ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';

const BADGE: Record<string, { label: string; cls: string }> = {
  vencida:    { label: 'Vencida',    cls: 'bg-destructive/10 text-destructive' },
  a_pagar:    { label: 'A pagar',    cls: 'bg-primary/10 text-primary' },
  a_declarar: { label: 'A declarar', cls: 'bg-alert/10 text-alert' },
};

export default function ObrigacaoItem({ o }: { o: ObrigacaoFiscal }) {
  const badge = BADGE[o.estado] ?? { label: o.estado, cls: 'bg-surface-3 text-muted-foreground' };
  const valor = o.valor != null ? brl(o.valor) : o.estimativaLocal != null ? `~${brl(o.estimativaLocal)} (estim.)` : '—';
  const acaoLabel = o.estado === 'a_declarar' ? 'Transmitir PGDAS-D' : 'Baixar DAS';

  return (
    <Link
      href={`/impostos/${o.competencia}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{competenciaLabel(o.competencia)}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground-2 tabular-nums">
          {valor}{o.vencimento ? ` · vence ${dataBR(o.vencimento)}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-sm font-medium text-primary">{acaoLabel}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
```

- [ ] **Step 2: Criar `FilaObrigacoes.tsx`**

```tsx
// @custom — Fila "Precisa de atenção": obrigações em estado != paga, ordenadas.
import { CheckCircle2 } from 'lucide-react';
import { ordenarFila, type ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';
import ObrigacaoItem from './ObrigacaoItem';

export default function FilaObrigacoes({ obrigacoes }: { obrigacoes: ObrigacaoFiscal[] }) {
  const fila = ordenarFila(obrigacoes);

  if (fila.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface p-6">
        <CheckCircle2 className="size-5 text-success" />
        <p className="text-sm text-muted-foreground">Tudo em dia. Nenhuma obrigação em aberto.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {fila.map((o) => (
        <ObrigacaoItem key={o.competencia} o={o} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -iE "ObrigacaoItem|FilaObrigacoes" | head`
Expected: sem saída (limpo p/ os novos arquivos).

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/ObrigacaoItem.tsx" "app/src/app/(auth)/impostos/FilaObrigacoes.tsx"
git commit -m "feat(impostos): componentes FilaObrigacoes + ObrigacaoItem"
```

---

## Task 5: `PreviaMesCorrente` (bloco discreto do mês corrente)

**Files:**
- Create: `src/app/(auth)/impostos/PreviaMesCorrente.tsx`

Bloco discreto com a estimativa comitada do mês corrente (de `apuracoes_fiscais`). Sem apuração → CTA "Calcular agora".

- [ ] **Step 1: Criar `PreviaMesCorrente.tsx`**

```tsx
// @custom — Prévia discreta do mês corrente (estimativa comitada). Não é obrigação.
import Link from 'next/link';
import { brl, competenciaLabel } from '@/lib/fiscal/guia';

export default function PreviaMesCorrente({
  competencia,
  estimativa,
}: {
  competencia: string;
  estimativa: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Mês corrente (prévia)</span>
      <span className="font-medium text-foreground">{competenciaLabel(competencia)}</span>
      {estimativa != null ? (
        <>
          <span className="tabular-nums text-foreground">· estimativa {brl(estimativa)}</span>
          <span className="text-muted-foreground-2">· não vence ainda</span>
        </>
      ) : (
        <Link href="/impostos/novo" className="text-primary hover:underline">
          · calcular agora
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -i "PreviaMesCorrente" | head`
Expected: sem saída.

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/PreviaMesCorrente.tsx"
git commit -m "feat(impostos): PreviaMesCorrente"
```

---

## Task 6: Seções do detalhe — `SecaoApuracao`, `SecaoDeclaracao`, `SecaoDas`

**Files:**
- Create: `src/app/(auth)/impostos/SecaoApuracao.tsx`
- Create: `src/app/(auth)/impostos/SecaoDeclaracao.tsx`
- Create: `src/app/(auth)/impostos/SecaoDas.tsx`

Reusa tipos/utis existentes: `ApuracaoRow` (de `./page`), `GuiaRow` (de `./HistoricoGuias`), `brl`/`dataBR`/`fatorRAplicavel`, `GuiaActions`, `PreviewDeclaracaoButton`.

- [ ] **Step 1: Criar `SecaoApuracao.tsx`** (migra a dl + "por anexo" do card atual)

```tsx
// @custom — Seção Apuração (estimativa) do detalhe da competência. Migra a dl do CompetenciaAtualCard.
import { brl } from '@/lib/fiscal/guia';
import { fatorRAplicavel } from '@/lib/fiscal/regime';
import type { ApuracaoRow } from './page';

export default function SecaoApuracao({ apuracao }: { apuracao: ApuracaoRow | null }) {
  if (!apuracao) {
    return <p className="text-sm text-muted-foreground">Sem apuração calculada para esta competência.</p>;
  }
  const payload = (apuracao.payload_calculo ?? null) as
    | { segregado?: boolean; porAnexo?: Array<{ anexo: string; receita: number; aliquotaEfetiva: number; valor: number }> }
    | null;
  const porAnexo = payload?.segregado && Array.isArray(payload.porAnexo) ? payload.porAnexo : null;

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {apuracao.anexo_simples && (
          <Linha label="Anexo">{apuracao.anexo_simples}{fatorRAplicavel(apuracao.anexo_simples) ? ' · Fator R' : ''}</Linha>
        )}
        {apuracao.receita_mes != null && <Linha label="Receita do mês">{brl(apuracao.receita_mes)}</Linha>}
        {apuracao.rbt12 != null && <Linha label="RBT12">{brl(apuracao.rbt12)}</Linha>}
        {apuracao.aliquota_efetiva != null && <Linha label="Alíquota efetiva">{(apuracao.aliquota_efetiva * 100).toFixed(2)}%</Linha>}
        {apuracao.valor_imposto != null && <Linha label="Estimativa">{brl(apuracao.valor_imposto)}</Linha>}
      </dl>
      {porAnexo && (
        <div className="mt-4 rounded-md border border-border divide-y divide-border text-sm">
          {porAnexo.map((p) => (
            <div key={p.anexo} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground-2">{p.anexo}</span>
              <span className="tabular-nums">{brl(p.receita)} · {(p.aliquotaEfetiva * 100).toFixed(2)}% · <strong className="text-foreground">{brl(p.valor)}</strong></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Criar `SecaoDeclaracao.tsx`**

```tsx
// @custom — Seção Declaração (PGDAS-D) do detalhe. Mostra a declaração ou a ação Transmitir (dry-run até a Fase 2).
import { dataBR } from '@/lib/fiscal/guia';
import PreviewDeclaracaoButton from './PreviewDeclaracaoButton';
import type { ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';

export default function SecaoDeclaracao({ o }: { o: ObrigacaoFiscal }) {
  if (o.declarada) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nº declaração</dt>
          <dd className="font-medium text-foreground">{o.numeroDeclaracao ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Transmitida em</dt>
          <dd className="font-medium text-foreground tabular-nums">{dataBR(o.dataTransmissao)}</dd>
        </div>
      </dl>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Ainda não transmitida.</p>
      {/* Até a Fase 2: o botão abre o dry-run/prévia (indicadorTransmissao=false). */}
      <PreviewDeclaracaoButton competencia={o.competencia} />
    </div>
  );
}
```

- [ ] **Step 3: Criar `SecaoDas.tsx`**

```tsx
// @custom — Seção DAS do detalhe. Valores + datas + Baixar PDF (reusa GuiaActions).
import { brl, dataBR } from '@/lib/fiscal/guia';
import GuiaActions from './GuiaActions';
import type { GuiaRow } from './HistoricoGuias';

export default function SecaoDas({ guia }: { guia: GuiaRow | null }) {
  if (!guia || (guia.valor == null && !guia.numero)) {
    return <p className="text-sm text-muted-foreground">O DAS nasce após a declaração.</p>;
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Linha label="Documento">{guia.numero ?? '—'}</Linha>
        <Linha label="Total">{brl(guia.valor)}</Linha>
        <Linha label="Principal">{brl(guia.principal)}</Linha>
        <Linha label="Multa">{brl(guia.multa)}</Linha>
        <Linha label="Juros">{brl(guia.juros)}</Linha>
        <Linha label="Vencimento">{dataBR(guia.vencimento)}</Linha>
        <Linha label="Pago em">{dataBR(guia.pagamento)}</Linha>
      </dl>
      <div className="flex flex-wrap gap-2">
        <GuiaActions guia={guia} variant="primary" />
      </div>
    </div>
  );
}

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -iE "SecaoApuracao|SecaoDeclaracao|SecaoDas" | head`
Expected: sem saída.

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/SecaoApuracao.tsx" "app/src/app/(auth)/impostos/SecaoDeclaracao.tsx" "app/src/app/(auth)/impostos/SecaoDas.tsx"
git commit -m "feat(impostos): seções do detalhe (Apuracao/Declaracao/Das)"
```

---

## Task 7: Rota de detalhe `/impostos/[competencia]`

**Files:**
- Create: `src/app/(auth)/impostos/[competencia]/page.tsx`

Server component: valida competência (`YYYYMM`) + ownership, carrega apuração/declaração/guia da competência, deriva a `ObrigacaoFiscal` e compõe as 3 seções.

- [ ] **Step 1: Criar `[competencia]/page.tsx`**

```tsx
// @custom — Detalhe de uma competência: apuração + declaração + DAS.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaLabel } from '@/lib/fiscal/guia';
import { derivarObrigacoes } from '@/lib/fiscal/obrigacoes';
import SecaoApuracao from '../SecaoApuracao';
import SecaoDeclaracao from '../SecaoDeclaracao';
import SecaoDas from '../SecaoDas';
import { toApuracaoRowDetalhe, toGuiaRowDetalhe } from '../mappers';
import type { ApuracaoRow } from '../page';
import type { GuiaRow } from '../HistoricoGuias';

const BADGE: Record<string, { label: string; cls: string }> = {
  vencida:    { label: 'Vencida',    cls: 'bg-destructive/10 text-destructive' },
  a_pagar:    { label: 'A pagar',    cls: 'bg-primary/10 text-primary' },
  a_declarar: { label: 'A declarar', cls: 'bg-alert/10 text-alert' },
  paga:       { label: 'Paga',       cls: 'bg-success/10 text-success' },
};

export default async function CompetenciaDetalhe({ params }: { params: Promise<{ competencia: string }> }) {
  const { competencia } = await params;
  if (!/^\d{6}$/.test(competencia)) redirect('/impostos');

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) redirect('/impostos');

  const [{ data: apRow }, { data: guiaRow }, { data: decRow }] = await Promise.all([
    supabase.from('apuracoes_fiscais')
      .select('id, competencia_referencia, anexo_simples, aliquota_efetiva, rbt12, receita_mes, valor_imposto, status, payload_calculo')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null).maybeSingle(),
    supabase.from('guias_fiscais')
      .select('id, competencia_referencia, competencia_mes, competencia_ano, valor_total, valor_principal, valor_multa, valor_juros, valor_pago, data_vencimento, data_pagamento, status, numero_das, numero_guia, url_pdf, url_guia, linha_digitavel')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null).maybeSingle(),
    supabase.from('declaracoes_fiscais')
      .select('competencia_referencia, numero_declaracao, data_transmissao')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).eq('tipo', 'PGDAS-D').maybeSingle(),
  ]);

  const apuracao: ApuracaoRow | null = apRow ? toApuracaoRowDetalhe(apRow) : null;
  const guia: GuiaRow | null = guiaRow ? toGuiaRowDetalhe(guiaRow) : null;

  const [obrigacao] = derivarObrigacoes({
    hoje: new Date(),
    competenciasEsperadas: [competencia],
    declaracoes: decRow ? [{ competencia, numeroDeclaracao: (decRow.numero_declaracao as string | null) ?? null, dataTransmissao: (decRow.data_transmissao as string | null) ?? null }] : [],
    guias: guia ? [{ competencia, numeroDas: guia.numero, valor: guia.valor, vencimento: guia.vencimento, pagamento: guia.pagamento, status: guia.status, pdfUrl: guia.pdfUrl }] : [],
    apuracoes: apuracao ? [{ competencia, estimativa: apuracao.valor_imposto }] : [],
  });

  const badge = BADGE[obrigacao.estado] ?? { label: obrigacao.estado, cls: 'bg-surface-3 text-muted-foreground' };

  return (
    <main className="p-6 max-w-3xl">
      <Link href="/impostos" className="inline-flex items-center gap-1 text-sm text-muted-foreground-2 hover:text-foreground">
        <ChevronLeft className="size-4" /> Voltar a Impostos
      </Link>
      <header className="mt-2 mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{competenciaLabel(competencia)}</h1>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      </header>

      <Secao titulo="Apuração (estimativa)"><SecaoApuracao apuracao={apuracao} /></Secao>
      <Secao titulo="Declaração (PGDAS-D)"><SecaoDeclaracao o={obrigacao} /></Secao>
      <Secao titulo="DAS"><SecaoDas guia={guia} /></Secao>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      <div className="rounded-xl border border-border bg-surface p-5">{children}</div>
    </section>
  );
}
```

Nota: `notFound` importado mas não usado é erro de lint — ele NÃO é importado acima (só `redirect`). Confirme que o import tem só `{ redirect }` se o `notFound` não for usado.

- [ ] **Step 2: Criar os mappers compartilhados** `src/app/(auth)/impostos/mappers.ts`

A `page.tsx` atual tem `toApuracaoRow`/`toGuiaRow` como funções locais. Extrair p/ um módulo compartilhado e reusar nas duas páginas. Criar `src/app/(auth)/impostos/mappers.ts`:

```ts
// @custom — Mappers de linhas do banco → row types da UI. Compartilhado entre page.tsx e [competencia].
import type { ApuracaoRow } from './page';
import type { GuiaRow } from './HistoricoGuias';

function numero(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toApuracaoRowDetalhe(a: Record<string, unknown>): ApuracaoRow {
  return {
    id: a.id as string,
    competencia_referencia: (a.competencia_referencia as string) ?? '',
    anexo_simples: (a.anexo_simples as string | null) ?? null,
    aliquota_efetiva: numero(a.aliquota_efetiva),
    rbt12: numero(a.rbt12),
    receita_mes: numero(a.receita_mes),
    valor_imposto: numero(a.valor_imposto),
    status: (a.status as string | null) ?? null,
    payload_calculo: (a.payload_calculo as Record<string, unknown> | null) ?? null,
  };
}

export function toGuiaRowDetalhe(g: Record<string, unknown>): GuiaRow {
  return {
    id: g.id as string,
    competencia: (g.competencia_referencia as string) ?? null,
    vencimento: (g.data_vencimento as string) ?? null,
    pagamento: (g.data_pagamento as string) ?? null,
    valor: numero(g.valor_total) ?? numero(g.valor_principal),
    principal: numero(g.valor_principal),
    multa: numero(g.valor_multa),
    juros: numero(g.valor_juros),
    status: (g.status as string) ?? null,
    pdfUrl: ((g.url_pdf as string) ?? (g.url_guia as string)) ?? null,
    linhaDigitavel: (g.linha_digitavel as string) ?? null,
    numero: ((g.numero_das as string) ?? (g.numero_guia as string)) ?? null,
  };
}
```

- [ ] **Step 3: Type-check**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | grep -iE "competencia\]|mappers" | head`
Expected: sem saída.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/[competencia]/page.tsx" "app/src/app/(auth)/impostos/mappers.ts"
git commit -m "feat(impostos): rota de detalhe /impostos/[competencia] + mappers compartilhados"
```

---

## Task 8: Reescrever `page.tsx` — prévia + fila + histórico; aposentar `CompetenciaAtualCard`

**Files:**
- Modify: `src/app/(auth)/impostos/page.tsx`
- Delete: `src/app/(auth)/impostos/CompetenciaAtualCard.tsx`

A `page.tsx` continua carregando regime/apuracoes/guias/declaracoes e mantendo o gate. Troca o bloco Simples (card + DeclaracoesSection + HistoricoGuias com todas) por: **prévia (mês corrente) + fila (derivada) + histórico (só pagas)**. MEI permanece como está.

- [ ] **Step 1: Atualizar imports e usar os mappers compartilhados**

No topo de `src/app/(auth)/impostos/page.tsx`, trocar os imports de componentes Simples:

Remover:
```ts
import CompetenciaAtualCard from './CompetenciaAtualCard';
import DeclaracoesSection, { type DeclaracaoRow } from './DeclaracoesSection';
```
Adicionar:
```ts
import PreviaMesCorrente from './PreviaMesCorrente';
import FilaObrigacoes from './FilaObrigacoes';
import { derivarObrigacoes, competenciasEsperadasDoAno } from '@/lib/fiscal/obrigacoes';
import { toApuracaoRowDetalhe, toGuiaRowDetalhe } from './mappers';
```
(Mantém `DeclaracoesMeiSection` para MEI. `DeclaracaoRow` deixa de ser usado aqui — remover do import se ficar órfão; o tipo segue exportado de `DeclaracoesSection`.)

- [ ] **Step 2: Trocar as funções locais `toApuracaoRow`/`toGuiaRow` pelos mappers**

Na `page.tsx`, **apagar** as funções locais `toApuracaoRow` e `toGuiaRow` (no rodapé do arquivo) e a função `numero` se ficar órfã. Substituir as chamadas `toApuracaoRow(...)`/`toGuiaRow(...)` por `toApuracaoRowDetalhe(...)`/`toGuiaRowDetalhe(...)`.

- [ ] **Step 3: Derivar as obrigações e separar atenção × paga (Simples)**

Logo após o cálculo de `isSimples`/`mostrarGate` e antes do `return`, adicionar:

```ts
  const competenciasEsperadas = competenciasEsperadasDoAno(new Date());
  const obrigacoes = isSimples
    ? derivarObrigacoes({
        hoje: new Date(),
        competenciasEsperadas,
        declaracoes: (declaracoes ?? [])
          .filter((d) => ((d.tipo as string) ?? 'PGDAS-D') === 'PGDAS-D')
          .map((d) => ({
            competencia: (d.competencia_referencia as string) ?? '',
            numeroDeclaracao: (d.numero_declaracao as string | null) ?? null,
            dataTransmissao: (d.data_transmissao as string | null) ?? null,
          })),
        guias: (guias ?? []).map((g) => {
          const row = toGuiaRowDetalhe(g);
          return {
            competencia: row.competencia ?? '',
            numeroDas: row.numero,
            valor: row.valor,
            vencimento: row.vencimento,
            pagamento: row.pagamento,
            status: row.status,
            pdfUrl: row.pdfUrl,
          };
        }),
        apuracoes: (apuracoes ?? []).map((a) => ({
          competencia: (a.competencia_referencia as string) ?? '',
          estimativa: a.valor_imposto != null ? Number(a.valor_imposto) : null,
        })),
      })
    : [];

  const obrigacoesAtencao = obrigacoes.filter((o) => o.estado !== 'paga');
  const pagasHistorico: GuiaRow[] = obrigacoes
    .filter((o) => o.estado === 'paga')
    .map((o) => (guias ?? []).find((g) => (g.competencia_referencia as string) === o.competencia))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map(toGuiaRowDetalhe);

  const apuracaoMesCorrente = (apuracoes ?? []).find((a) => (a.competencia_referencia as string) === competenciaAtual) ?? null;
  const estimativaMesCorrente = apuracaoMesCorrente?.valor_imposto != null ? Number(apuracaoMesCorrente.valor_imposto) : null;
```

- [ ] **Step 4: Trocar o bloco de render Simples**

No JSX, dentro de `{!mostrarGate && (...)}`, **substituir** as seções Simples (CompetenciaAtualCard + DeclaracoesSection + Histórico com todas) por:

```tsx
              {isSimples ? (
                <>
                  <section className="mb-6">
                    <PreviaMesCorrente competencia={competenciaAtual} estimativa={estimativaMesCorrente} />
                  </section>

                  <section className="mb-8">
                    <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Precisa de atenção</h2>
                    <FilaObrigacoes obrigacoes={obrigacoesAtencao} />
                  </section>

                  <section>
                    <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Histórico</h2>
                    <HistoricoGuias initial={pagasHistorico} />
                  </section>
                </>
              ) : (
                <>
                  <section className="mb-8">
                    <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Competência atual</h2>
                    <CompetenciaAtualCardMei
                      apuracao={apuracaoAtual ? toApuracaoRowDetalhe(apuracaoAtual) : null}
                      guia={guiaAtual ? toGuiaRowDetalhe(guiaAtual) : null}
                      competencia={competenciaAtual}
                    />
                  </section>
                  <section className="mb-8">
                    <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações</h2>
                    <DeclaracoesMeiSection
                      declaracoes={declaracoesRows.filter((d) => d.tipo === 'DASN-SIMEI')}
                      anoCalendario={Number(competenciaAtual.slice(0, 4)) - 1}
                    />
                  </section>
                  <section>
                    <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Histórico de guias</h2>
                    <HistoricoGuias initial={historico} />
                  </section>
                </>
              )}
```

**Decisão de escopo MEI:** o spec mantém o MEI "como está", mas o `CompetenciaAtualCard` será deletado. Para não quebrar o MEI, **renomear** o componente atual para uso exclusivo MEI: criar `CompetenciaAtualCardMei.tsx` com o conteúdo atual do `CompetenciaAtualCard.tsx` **sem** os ramos Simples (já removidos na Task de botões: hoje ele só tem `GuiaActions` + `PreviewDeclaracaoButton` no caminho Simples e `GerarDas*` já foram removidos). Concretamente: copiar `CompetenciaAtualCard.tsx` → `CompetenciaAtualCardMei.tsx`, ajustar o nome do componente e remover a prop `isSimples` (MEI: `isMei` sempre true). Manter `historico`/`guiaAtual`/`apuracaoAtual`/`declaracoesRows` como já existem na page para o ramo MEI.

- [ ] **Step 5: Deletar `CompetenciaAtualCard.tsx`**

```bash
cd /home/allan/Projetos/claude/balu
git rm "app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx"
```

- [ ] **Step 6: Type-check + testes**

Run:
```
cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit 2>&1 | head -20
npx vitest run src/lib/fiscal/obrigacoes.test.ts src/lib/fiscal/guia.test.ts
```
Expected: `TypeScript: No errors found`; testes PASS.

- [ ] **Step 7: Smoke manual no navegador**

```
cd /home/allan/Projetos/claude/balu/app && npm run dev   # se ainda não estiver rodando
```
Com a AL PISCINAS (Simples, já sincronizada — rode `node scripts/_reset-gate-al-piscinas.mjs` e o gate "Atualizar" antes, com o PAGAMENTOS71 de volta):
1. `/impostos` → topo mostra **prévia do mês corrente**; **fila** com Abril `Vencida` + Maio `A declarar`; **histórico** com Jan–Mar `Paga` (expansível).
2. Clicar em **Maio** → `/impostos/202605` → seção Apuração (estimativa), Declaração com botão **Transmitir PGDAS-D** (dry-run), DAS "nasce após a declaração".
3. Clicar em **Março** → seções preenchidas + **Baixar PDF** na seção DAS.
4. "‹ Voltar a Impostos" retorna.
5. MEI (outra empresa, se houver) → tela inalterada.

- [ ] **Step 8: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add -A "app/src/app/(auth)/impostos/"
git commit -m "feat(impostos): /impostos vira prévia + fila de obrigações + histórico (aposenta card único)"
```

---

## Self-Review Checklist

- [x] **Cobertura do spec:** helper derivado (T1-3) ✓ · fila+item (T4) ✓ · prévia (T5) ✓ · seções detalhe (T6) ✓ · rota detalhe (T7) ✓ · page.tsx prévia+fila+histórico, aposenta card (T8) ✓ · testes do núcleo (T1-3) ✓
- [x] **Estados:** as 4 transições + ordenação têm teste (T2, T3); enumeração "esperada → a_declarar" testada (T2)
- [x] **Sem schema novo:** confirmado — tudo deriva das tabelas atuais
- [x] **Tipos consistentes:** `ObrigacaoFiscal`/`GuiaInput`/`DeclaracaoInput`/`ApuracaoInput` definidos em T1-2 e usados igual em T4/T7/T8; `toGuiaRowDetalhe`/`toApuracaoRowDetalhe` definidos em T7 e reusados em T8
- [x] **MEI intocado:** T8 isola o MEI num `CompetenciaAtualCardMei` (cópia do atual), mantém DeclaracoesMeiSection
- [x] **Fase 2:** ação Transmitir = `PreviewDeclaracaoButton` (dry-run) — slot pronto, sem depender da transmissão real

**Risco anotado:** a Task 8 é a mais pesada (reescrita da `page.tsx` + isolamento MEI). Se o ramo MEI ficar complexo, dá pra quebrar em duas (8a: Simples; 8b: extrair CompetenciaAtualCardMei).
