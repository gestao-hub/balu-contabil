# Ajustes de UX (Notas/Clientes/Menu/Limite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cinco ajustes de UX: redirect ao trocar de empresa, preview de limite de emissão nas Notas, filtros das Notas na URL (Voltar preserva filtro) com mês vigente default, paginação 100/pág em Notas e Clientes.

**Architecture:** Tudo client-side espelhando o padrão já existente do Honorários (paginação por `slice`, footer topo+rodapé). Lógica de negócio isolada em módulos puros testáveis (`limite-emissao.ts`, `notas-filtros.ts`, `mes-vigente.ts`); fetch de soma anual em módulo server-only (`emitido-ano.ts`). Filtros das Notas passam a viver na URL (searchParams) para sobreviver ao Voltar.

**Tech Stack:** Next.js 15 App Router, React (client islands `'use client'`), Supabase JS, Vitest, Tailwind (tema: `success`/`alert`/`destructive`).

**Spec:** `docs/superpowers/specs/2026-06-03-ajustes-ux-notas-clientes-design.md`

**Convenção de testes:** `cd app && npx vitest run <arquivo>` para um teste; `cd app && npx vitest run` para a suíte; `cd app && npx tsc --noEmit` para typecheck. Todos os comandos rodam de `/home/allan/Projetos/claude/balu/app`.

**Ordem dos PRs (revisar PR a PR):** A → B → C → D → E. D depende de C (helper `notas-filtros.ts`). Os demais são independentes.

---

## PR A — Redirect ao trocar de empresa → Início

### Task A1: Navegar para `/` após trocar de empresa

**Files:**
- Modify: `app/src/components/MenuLateral.tsx` (função `changeCompany`, ~linha 75-77)

- [ ] **Step 1: Aplicar a mudança**

No corpo de `changeCompany`, no caminho de sucesso, troque o `router.refresh()` por `push` + `refresh`. Trecho atual (linhas 75-77):

```tsx
      toast('success', 'Empresa alterada');
      setCompanyMenuOpen(false);
      router.refresh();
```

Passa a ser:

```tsx
      toast('success', 'Empresa alterada');
      setCompanyMenuOpen(false);
      // Leva pro Início e re-renderiza o layout com a empresa nova (o refresh cobre
      // o caso de já estarmos em '/', onde push('/') não dispararia novo render).
      router.push('/');
      router.refresh();
```

Não altere o `finally { setSwitching(false); }` (o comentário existente explica por que ele fica lá).

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/MenuLateral.tsx
git commit -m "feat(menu): redireciona para Início ao trocar de empresa"
```

**Smoke manual (não bloqueia):** logar, ir em `/clientes`, trocar de empresa no seletor → deve cair em `/` (Início) com os dados da empresa nova.

---

## PR B — Preview de limite de emissão nas Notas

### Task B1: Módulo puro `limite-emissao.ts` (TDD)

**Files:**
- Create: `app/src/lib/fiscal/limite-emissao.ts`
- Test: `app/src/lib/fiscal/limite-emissao.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `app/src/lib/fiscal/limite-emissao.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { limitePorRegime, nivelPorPct, calcularLimiteEmissao } from './limite-emissao';

describe('limitePorRegime', () => {
  it('MEI (4) → 81000', () => expect(limitePorRegime('4')).toBe(81000));
  it('Simples (1 e 2) → 4800000', () => {
    expect(limitePorRegime('1')).toBe(4800000);
    expect(limitePorRegime('2')).toBe(4800000);
  });
  it('Regime Normal (3) / nulo / desconhecido → null', () => {
    expect(limitePorRegime('3')).toBeNull();
    expect(limitePorRegime(null)).toBeNull();
    expect(limitePorRegime(undefined)).toBeNull();
    expect(limitePorRegime('9')).toBeNull();
  });
});

describe('nivelPorPct', () => {
  it('≤60 verde', () => {
    expect(nivelPorPct(0)).toBe('verde');
    expect(nivelPorPct(60)).toBe('verde');
  });
  it('61–80 amarelo', () => {
    expect(nivelPorPct(61)).toBe('amarelo');
    expect(nivelPorPct(80)).toBe('amarelo');
  });
  it('>80 vermelho', () => {
    expect(nivelPorPct(81)).toBe('vermelho');
    expect(nivelPorPct(100)).toBe('vermelho');
    expect(nivelPorPct(120)).toBe('vermelho');
  });
});

describe('calcularLimiteEmissao', () => {
  it('MEI 56% → verde, mostrar', () => {
    const r = calcularLimiteEmissao('4', 45000, 2026);
    expect(r).toEqual({ mostrar: true, limite: 81000, total: 45000, pct: 56, nivel: 'verde', ano: 2026 });
  });
  it('Simples acima de 80% → vermelho', () => {
    const r = calcularLimiteEmissao('1', 4000000, 2026);
    expect(r.mostrar).toBe(true);
    if (r.mostrar) {
      expect(r.pct).toBe(83);
      expect(r.nivel).toBe('vermelho');
    }
  });
  it('Regime Normal → não mostra', () => {
    expect(calcularLimiteEmissao('3', 999999, 2026)).toEqual({ mostrar: false });
  });
  it('estouro (pct>100) → vermelho', () => {
    const r = calcularLimiteEmissao('4', 90000, 2026);
    expect(r.mostrar).toBe(true);
    if (r.mostrar) {
      expect(r.pct).toBe(111);
      expect(r.nivel).toBe('vermelho');
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/limite-emissao.test.ts`
Expected: FAIL — `Failed to resolve import "./limite-emissao"`.

- [ ] **Step 3: Implementar o módulo**

Create `app/src/lib/fiscal/limite-emissao.ts`:

```ts
// Preview do limite de emissão por regime. Base legal do "estouro": faturamento
// do ano-calendário. MEI = R$81.000/ano; Simples = R$4.800.000/ano; Regime Normal
// (Lucro Real/Presumido) não tem teto → banner oculto.

export type NivelLimite = 'verde' | 'amarelo' | 'vermelho';

export type LimiteEmissao =
  | { mostrar: false }
  | { mostrar: true; limite: number; total: number; pct: number; nivel: NivelLimite; ano: number };

const LIMITE_MEI = 81000;
const LIMITE_SIMPLES = 4800000;

export function limitePorRegime(code: string | null | undefined): number | null {
  if (code === '4') return LIMITE_MEI;                 // MEI
  if (code === '1' || code === '2') return LIMITE_SIMPLES; // Simples (incl. excesso de sublimite)
  return null;                                          // Regime Normal (3) / desconhecido
}

export function nivelPorPct(pct: number): NivelLimite {
  if (pct <= 60) return 'verde';
  if (pct <= 80) return 'amarelo';
  return 'vermelho';
}

export function calcularLimiteEmissao(
  code: string | null | undefined,
  total: number,
  ano: number,
): LimiteEmissao {
  const limite = limitePorRegime(code);
  if (limite == null) return { mostrar: false };
  const pct = limite > 0 ? Math.round((total / limite) * 100) : 0;
  return { mostrar: true, limite, total, pct, nivel: nivelPorPct(pct), ano };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/limite-emissao.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/limite-emissao.ts app/src/lib/fiscal/limite-emissao.test.ts
git commit -m "feat(notas): módulo puro de limite de emissão por regime"
```

### Task B2: Fetch server-only da soma anual `emitido-ano.ts`

**Files:**
- Create: `app/src/lib/fiscal/emitido-ano.ts`

- [ ] **Step 1: Implementar o fetch**

Create `app/src/lib/fiscal/emitido-ano.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Soma o valor das notas ATIVAS (NFe/NFCe/NFSe) emitidas no ano-calendário.
// Mesma família de filtro de receitas-source.ts.
const TIPOS = ['NFe', 'NFCe', 'NFSe'];

export async function somarEmitidoNoAno(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<number> {
  const inicio = `${ano}-01-01`;
  const fim = `${ano + 1}-01-01`;
  const { data } = await supabase
    .from('notas_fiscais')
    .select('valor_total')
    .eq('company_id', companyId)
    .eq('status', 'ativa')
    .in('tipo_documento', TIPOS)
    .gte('data_emissao', inicio)
    .lt('data_emissao', fim);
  return (data ?? []).reduce(
    (acc, n) => acc + (Number((n as { valor_total: number | null }).valor_total) || 0),
    0,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`. (Se `SupabaseClient` reclamar do import path, confirme com `grep -n "SupabaseClient" src/lib/fiscal/receitas-source.ts` e use o mesmo import.)

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/emitido-ano.ts
git commit -m "feat(notas): soma server-only do emitido no ano"
```

### Task B3: Componente `LimiteEmissaoBanner` (server)

**Files:**
- Create: `app/src/app/(auth)/notas_fiscais/LimiteEmissaoBanner.tsx`

- [ ] **Step 1: Implementar o banner**

Create `app/src/app/(auth)/notas_fiscais/LimiteEmissaoBanner.tsx`:

```tsx
import type { LimiteEmissao, NivelLimite } from '@/lib/fiscal/limite-emissao';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Cores do tema por nível (track + barra).
const BAR: Record<NivelLimite, string> = {
  verde: 'bg-success',
  amarelo: 'bg-alert',
  vermelho: 'bg-destructive',
};
const TEXT: Record<NivelLimite, string> = {
  verde: 'text-success',
  amarelo: 'text-alert',
  vermelho: 'text-destructive',
};

export default function LimiteEmissaoBanner({ limite }: { limite: LimiteEmissao }) {
  if (!limite.mostrar) return null;
  const { total, limite: teto, pct, nivel, ano } = limite;
  const largura = Math.min(pct, 100);
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">Limite de emissão · {ano}</span>
        <span className={`tabular-nums font-medium ${TEXT[nivel]}`}>
          {brl.format(total)} / {brl.format(teto)} · {pct}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${BAR[nivel]}`} style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/LimiteEmissaoBanner.tsx"
git commit -m "feat(notas): banner de limite de emissão"
```

### Task B4: Ligar o banner na página de Notas

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/page.tsx`

- [ ] **Step 1: Importar dependências**

No topo de `page.tsx`, abaixo dos imports existentes, adicione:

```tsx
import { calcularLimiteEmissao, type LimiteEmissao } from '@/lib/fiscal/limite-emissao';
import { somarEmitidoNoAno } from '@/lib/fiscal/emitido-ano';
import LimiteEmissaoBanner from './LimiteEmissaoBanner';
```

- [ ] **Step 2: Computar o limite dentro do bloco `if (companyId)`**

Logo após resolver `notas` (depois do `notas = rows.map(...)`, ainda dentro do `if (companyId)`), adicione o cálculo. Primeiro declare a variável de limite no topo da função, junto de `notas`:

Onde está (linha ~11):
```tsx
  let notas: NotaListRow[] = [];
```
Adicione abaixo:
```tsx
  let limite: LimiteEmissao = { mostrar: false };
```

Dentro do `if (companyId)`, ao final (depois do `notas = rows.map(...)`), adicione:
```tsx
      const { data: fiscal } = await supabase
        .from('empresas_fiscais')
        .select('Code_regime_tributario')
        .eq('empresa_id', companyId)
        .is('deleted_at', null)
        .maybeSingle();
      const ano = new Date(Date.now() - 3 * 60 * 60 * 1000).getFullYear(); // BRT
      const totalAno = await somarEmitidoNoAno(supabase, companyId, ano);
      limite = calcularLimiteEmissao(
        (fiscal?.Code_regime_tributario as string | null) ?? null,
        totalAno,
        ano,
      );
```

- [ ] **Step 3: Renderizar o banner acima da lista**

No JSX, dentro do `<main>`, entre o `</header>` e `<NotasFiscaisList ... />`:

```tsx
      <LimiteEmissaoBanner limite={limite} />
      <NotasFiscaisList initial={notas} />
```

- [ ] **Step 4: Typecheck + suíte**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` e suíte verde (sem regressão).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/page.tsx"
git commit -m "feat(notas): exibe preview de limite de emissão na listagem"
```

**Smoke manual:** abrir `/notas_fiscais` com empresa MEI → banner com R$81.000; com Simples → R$4.800.000; com Regime Normal → sem banner.

---

## PR C — Filtros das Notas na URL + Voltar preserva filtro + mês vigente default

### Task C1: Util compartilhado `mes-vigente.ts`

**Files:**
- Create: `app/src/lib/format/mes-vigente.ts`

- [ ] **Step 1: Implementar (extraído do padrão do Honorários)**

Create `app/src/lib/format/mes-vigente.ts`:

```ts
// Primeiro/último dia do mês corrente em BRT (UTC-3), em ISO 'YYYY-MM-DD'.
// Mesma lógica usada no HonorarioList.

export function primeiroDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ultimoDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const last = new Date(brt.getFullYear(), brt.getMonth() + 1, 0).getDate();
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/format/mes-vigente.ts
git commit -m "feat(format): util de mês vigente (BRT) compartilhável"
```

### Task C2: Helper puro `notas-filtros.ts` (TDD)

**Files:**
- Create: `app/src/app/(auth)/notas_fiscais/notas-filtros.ts`
- Test: `app/src/app/(auth)/notas_fiscais/notas-filtros.test.ts`

> **Nota:** o tipo `Filtros` já inclui `page` aqui (a persistência da página na URL faz parte da história de "Voltar preserva filtro"). A UI de paginação que consome `page` entra na PR D — sem mais mudanças neste helper.

- [ ] **Step 1: Escrever o teste que falha**

Create `app/src/app/(auth)/notas_fiscais/notas-filtros.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFiltrosFromParams, filtrosToQueryString } from './notas-filtros';
import { primeiroDiaMesISO, ultimoDiaMesISO } from '@/lib/format/mes-vigente';

describe('parseFiltrosFromParams', () => {
  it('sem params → mês vigente + defaults', () => {
    const f = parseFiltrosFromParams(new URLSearchParams(''));
    expect(f).toEqual({
      q: '',
      tipo: 'todos',
      status: 'todos',
      start: primeiroDiaMesISO(),
      end: ultimoDiaMesISO(),
      page: 1,
    });
  });

  it('com params explícitos → respeita', () => {
    const f = parseFiltrosFromParams(
      new URLSearchParams('q=acme&tipo=NFe&status=ativa&start=2026-01-01&end=2026-03-31&page=2'),
    );
    expect(f).toEqual({
      q: 'acme',
      tipo: 'NFe',
      status: 'ativa',
      start: '2026-01-01',
      end: '2026-03-31',
      page: 2,
    });
  });

  it('periodo=all → período vazio explícito (não cai no default)', () => {
    const f = parseFiltrosFromParams(new URLSearchParams('periodo=all'));
    expect(f.start).toBeNull();
    expect(f.end).toBeNull();
  });

  it('page ausente → 1; inválida/<1 → 1; válida → número', () => {
    expect(parseFiltrosFromParams(new URLSearchParams('')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=0')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=abc')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=3')).page).toBe(3);
  });
});

describe('filtrosToQueryString', () => {
  it('omite defaults de q/tipo/status/page; inclui período como datas', () => {
    const qs = filtrosToQueryString({
      q: '',
      tipo: 'todos',
      status: 'todos',
      start: '2026-01-01',
      end: '2026-03-31',
      page: 1,
    });
    const sp = new URLSearchParams(qs);
    expect(sp.get('q')).toBeNull();
    expect(sp.get('tipo')).toBeNull();
    expect(sp.get('status')).toBeNull();
    expect(sp.get('page')).toBeNull();
    expect(sp.get('start')).toBe('2026-01-01');
    expect(sp.get('end')).toBe('2026-03-31');
  });

  it('período vazio → periodo=all; page>1 vira param', () => {
    const qs = filtrosToQueryString({ q: '', tipo: 'todos', status: 'todos', start: null, end: null, page: 2 });
    const sp = new URLSearchParams(qs);
    expect(sp.get('periodo')).toBe('all');
    expect(sp.get('page')).toBe('2');
  });

  it('round-trip parse→stringify→parse é estável', () => {
    const original = parseFiltrosFromParams(
      new URLSearchParams('q=x&tipo=NFSe&status=erro&start=2026-02-01&end=2026-02-28&page=4'),
    );
    const round = parseFiltrosFromParams(new URLSearchParams(filtrosToQueryString(original)));
    expect(round).toEqual(original);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run "src/app/(auth)/notas_fiscais/notas-filtros.test.ts"`
Expected: FAIL — `Failed to resolve import "./notas-filtros"`.

- [ ] **Step 3: Implementar o helper**

Create `app/src/app/(auth)/notas_fiscais/notas-filtros.ts`:

```ts
import { primeiroDiaMesISO, ultimoDiaMesISO } from '@/lib/format/mes-vigente';

export type Filtros = {
  q: string;
  tipo: string;     // 'todos' default
  status: string;   // 'todos' default
  start: string | null;
  end: string | null;
  page: number;     // 1 default
};

type ParamsLike = { get(key: string): string | null };

// Sem params de período → mês vigente (primeira visita). `periodo=all` → vazio
// explícito (usuário limpou). start/end presentes → usa-os.
export function parseFiltrosFromParams(sp: ParamsLike): Filtros {
  const q = sp.get('q') ?? '';
  const tipo = sp.get('tipo') ?? 'todos';
  const status = sp.get('status') ?? 'todos';

  let start: string | null;
  let end: string | null;
  const periodo = sp.get('periodo');
  const rawStart = sp.get('start');
  const rawEnd = sp.get('end');
  if (periodo === 'all') {
    start = null;
    end = null;
  } else if (rawStart || rawEnd) {
    start = rawStart;
    end = rawEnd;
  } else {
    start = primeiroDiaMesISO();
    end = ultimoDiaMesISO();
  }

  const pageRaw = Number.parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return { q, tipo, status, start, end, page };
}

export function filtrosToQueryString(f: Filtros): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.tipo !== 'todos') sp.set('tipo', f.tipo);
  if (f.status !== 'todos') sp.set('status', f.status);
  if (f.start || f.end) {
    if (f.start) sp.set('start', f.start);
    if (f.end) sp.set('end', f.end);
  } else {
    sp.set('periodo', 'all');
  }
  if (f.page > 1) sp.set('page', String(f.page));
  return sp.toString();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run "src/app/(auth)/notas_fiscais/notas-filtros.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/notas-filtros.ts" "app/src/app/(auth)/notas_fiscais/notas-filtros.test.ts"
git commit -m "feat(notas): helper puro de filtros na URL (mês vigente default + page)"
```

### Task C3: `NotasFiscaisList` lê/escreve filtros na URL

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx`

- [ ] **Step 1: Trocar imports e inicialização de estado**

Topo do arquivo — trocar a linha de import do React e adicionar `useSearchParams`/`useEffect`/`useRef`:

De:
```tsx
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
```
Para:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { parseFiltrosFromParams, filtrosToQueryString } from './notas-filtros';
```

(Mantenha o import de `FilterPeriodo` — ele já existe.)

- [ ] **Step 2: Inicializar estado a partir da URL**

Dentro do componente, troque o bloco de estado atual:

```tsx
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoRange>({ start: null, end: null });
  const [tipo, setTipo] = useState<string>('todos');
  const [status, setStatus] = useState<string>('todos');
  const [exporting, setExporting] = useState(false);
```

por:

```tsx
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  // Estado inicial derivado da URL (parse uma vez no mount). Sem params → mês vigente.
  const inicial = useMemo(() => parseFiltrosFromParams(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [query, setQuery] = useState(inicial.q);
  const [periodo, setPeriodo] = useState<PeriodoRange>({ start: inicial.start, end: inicial.end });
  const [tipo, setTipo] = useState<string>(inicial.tipo);
  const [status, setStatus] = useState<string>(inicial.status);
  const [pagina, setPagina] = useState(inicial.page);
  const [exporting, setExporting] = useState(false);

  // Sincroniza os filtros na URL (sem empilhar histórico nem rolar a página).
  // Pula o 1º run pra não reescrever a URL limpa da primeira visita.
  const primeiroSync = useRef(true);
  useEffect(() => {
    if (primeiroSync.current) {
      primeiroSync.current = false;
      return;
    }
    const qs = filtrosToQueryString({ q: query, tipo, status, start: periodo.start, end: periodo.end, page: pagina });
    router.replace(qs ? `/notas_fiscais?${qs}` : '/notas_fiscais', { scroll: false });
  }, [query, tipo, status, periodo, pagina, router]);
```

> O `setPagina` já existe aqui, mas a paginação (slice/footer/reset) só é consumida na PR D. Nesta PR a lista ainda renderiza `filtered` por inteiro.

- [ ] **Step 3: Passar `initial` ao FilterPeriodo**

Troque (linha ~143):
```tsx
          <FilterPeriodo onChange={setPeriodo} />
```
por:
```tsx
          <FilterPeriodo initial={periodo} onChange={setPeriodo} />
```

- [ ] **Step 4: Typecheck + suíte**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` e suíte verde.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx"
git commit -m "feat(notas): filtros vivem na URL (searchParams)"
```

### Task C4: Voltar do detalhe via `router.back()`

**Files:**
- Create: `app/src/app/(auth)/notas_fiscais/[id]/BackButton.tsx`
- Modify: `app/src/app/(auth)/notas_fiscais/[id]/page.tsx` (linha 88)

- [ ] **Step 1: Criar o botão client**

Create `app/src/app/(auth)/notas_fiscais/[id]/BackButton.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';

// Volta na história do navegador para preservar os filtros (que vivem na URL da
// listagem). Fallback para a listagem caso não haja histórico (acesso direto).
export default function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/notas_fiscais');
      }}
      className="text-sm text-primary hover:underline"
    >
      ← Voltar
    </button>
  );
}
```

- [ ] **Step 2: Usar o botão na página de detalhe**

Em `[id]/page.tsx`, adicione o import no topo (junto dos outros imports):
```tsx
import BackButton from './BackButton';
```

Troque a linha 88:
```tsx
      <a href="/notas_fiscais" className="text-sm text-primary hover:underline">← Voltar</a>
```
por:
```tsx
      <BackButton />
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/[id]/BackButton.tsx" "app/src/app/(auth)/notas_fiscais/[id]/page.tsx"
git commit -m "feat(notas): Voltar do detalhe preserva filtro (router.back)"
```

**Smoke manual:** em `/notas_fiscais`, aplicar filtro (tipo NFe + busca) → a URL ganha `?tipo=NFe&q=...`; abrir uma nota; clicar Voltar → retorna à listagem com os mesmos filtros aplicados.

---

## PR D — Paginação das Notas (100/pág, footer topo + rodapé)

> Depende da PR C (o helper `notas-filtros.ts` já tem `page` e o estado `pagina` já existe em `NotasFiscaisList`).

### Task D1: Remover o `.limit(50)` da página

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/page.tsx` (linha ~26)

- [ ] **Step 1: Trocar o limite**

Troque:
```tsx
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(50);
```
por (cap de segurança alto, paginação é client-side):
```tsx
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(2000);
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/page.tsx"
git commit -m "feat(notas): carrega até 2000 notas p/ paginação client-side"
```

### Task D2: Paginação + footer topo/rodapé em `NotasFiscaisList`

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx`

> O estado `pagina`/`setPagina` e o sync na URL já vieram da PR C (Task C3). Aqui só entra a constante `POR_PAGINA`, o slice, o reset ao filtrar, o footer e a troca `filtered.map`→`paginados.map`.

- [ ] **Step 1: Importar ícones e adicionar a constante de tamanho de página**

No import de `lucide-react`, adicione `ChevronLeft, ChevronRight`:
```tsx
import { Search, Download, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
```

Após o estado existente (depois de `const [exporting, setExporting] = useState(false);`), adicione a constante (o `pagina`/`setPagina` já existe da PR C):
```tsx
  const POR_PAGINA = 100;
```

- [ ] **Step 2: Resetar página quando filtros mudam**

Crie handlers que zeram a página. Troque os `onChange` dos controles:

Busca (linha ~111):
```tsx
            onChange={(e) => setQuery(e.target.value)}
```
→
```tsx
            onChange={(e) => { setQuery(e.target.value); setPagina(1); }}
```

Tipo (linha ~120):
```tsx
            onChange={(e) => setTipo(e.target.value)}
```
→
```tsx
            onChange={(e) => { setTipo(e.target.value); setPagina(1); }}
```

Status (linha ~132):
```tsx
            onChange={(e) => setStatus(e.target.value)}
```
→
```tsx
            onChange={(e) => { setStatus(e.target.value); setPagina(1); }}
```

FilterPeriodo (linha ~143):
```tsx
          <FilterPeriodo initial={periodo} onChange={setPeriodo} />
```
→
```tsx
          <FilterPeriodo initial={periodo} onChange={(p) => { setPeriodo(p); setPagina(1); }} />
```

- [ ] **Step 3: Calcular slice da página**

Logo após o `const filtered = useMemo(...)` (depois da linha ~70), adicione:
```tsx
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
```

- [ ] **Step 4: Trocar `filtered.map` por `paginados.map` no corpo da tabela**

Na renderização das linhas (linha ~187), troque:
```tsx
              filtered.map((n) => {
```
por:
```tsx
              paginados.map((n) => {
```
(A condição de vazio `filtered.length === 0` permanece como está.)

- [ ] **Step 5: Adicionar o footer de paginação acima e abaixo da tabela**

Defina o footer como elemento reutilizável dentro do componente, logo antes do `return (`:
```tsx
  const paginador = totalPaginas > 1 ? (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtered.length)} de {filtered.length}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
        <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  ) : null;
```

Renderize-o antes e depois da `<div className="overflow-x-auto ...">` que envolve a `<table>`. Coloque um wrapper com espaçamento. Antes do `<div className="overflow-x-auto rounded-xl border border-border bg-surface">`:
```tsx
      {paginador && <div className="mb-3">{paginador}</div>}
```
E imediatamente após o fechamento dessa `</div>` (a que fecha o `overflow-x-auto`):
```tsx
      {paginador && <div className="mt-3">{paginador}</div>}
```

- [ ] **Step 6: Typecheck + suíte**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` e suíte verde.

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/NotasFiscaisList.tsx"
git commit -m "feat(notas): paginação 100/pág com footer topo e rodapé"
```

**Smoke manual:** com >100 notas no período, conferir footer em cima e embaixo, navegação entre páginas, e que a página vai pra URL (`?page=2`) e sobrevive ao Voltar.

---

## PR E — Paginação dos Clientes (100/pág, footer topo + rodapé)

### Task E1: Paginação client-side em `ClientesListClient`

**Files:**
- Modify: `app/src/components/ClientesListClient.tsx`

- [ ] **Step 1: Importar ícones e adicionar estado de página**

No import de `lucide-react` (linha 8), adicione `ChevronLeft, ChevronRight`:
```tsx
import { Pencil, Trash2, Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
```

Após `const [query, setQuery] = useState('');` (linha ~30), adicione:
```tsx
  const POR_PAGINA = 100;
  const [pagina, setPagina] = useState(1);
```

- [ ] **Step 2: Resetar página ao buscar**

Troque o `onChange` do input de busca (linha ~97):
```tsx
            onChange={(e) => setQuery(e.target.value)}
```
→
```tsx
            onChange={(e) => { setQuery(e.target.value); setPagina(1); }}
```

- [ ] **Step 3: Calcular slice**

Após o `const filtered = useMemo(...)` (depois da linha ~47), adicione:
```tsx
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
```

- [ ] **Step 4: Definir o footer e renderizar topo/rodapé**

Antes do `return (` (linha ~89), adicione:
```tsx
  const paginador = totalPaginas > 1 ? (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtered.length)} de {filtered.length}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
        <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  ) : null;
```

Antes da `<div className="overflow-x-auto rounded-xl border border-border bg-surface">`:
```tsx
      {paginador && <div className="mb-3">{paginador}</div>}
```
Imediatamente após o fechamento dessa `</div>` (a do `overflow-x-auto`, antes do `<ClienteFormDialog>`):
```tsx
      {paginador && <div className="mt-3">{paginador}</div>}
```

- [ ] **Step 5: Trocar `filtered.map` por `paginados.map`**

Na tabela (linha ~135), troque:
```tsx
              filtered.map((c) => (
```
por:
```tsx
              paginados.map((c) => (
```
(A condição de vazio `filtered.length === 0` permanece.)

- [ ] **Step 6: Typecheck + suíte**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` e suíte verde.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/ClientesListClient.tsx
git commit -m "feat(clientes): paginação 100/pág com footer topo e rodapé"
```

**Smoke manual:** com >100 clientes, conferir footer em cima e embaixo e navegação; buscar deve resetar pra página 1.

---

## Notas finais

- **`FilterPeriodo` em Clientes** continua importado-e-não-ligado (fora de escopo — não mexer).
- **Honorários** não é tocado; `mes-vigente.ts` é criado novo e usado só nas Notas (evita churn/regressão no Honorários).
- **Verificação final** (após todas as PRs): `cd app && npx tsc --noEmit && npx vitest run` deve ficar verde.
