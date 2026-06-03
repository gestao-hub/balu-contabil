# Spec — Ajustes de UX: troca de empresa, filtros/paginação de Notas e Clientes, limite de emissão

> **Data:** 2026-06-03
> **Escopo:** 5 ajustes de UX independentes (mesma área: menu, lista de Notas, lista de Clientes).
> **Entrega:** 1 spec, mas implementação em PRs separados (revisão PR a PR).

## Contexto

Cinco ajustes pedidos pelo usuário, todos sobre navegação/listagens já existentes. Mapa do estado atual (explorado em 2026-06-03):

- **Troca de empresa:** `src/components/MenuLateral.tsx` → `changeCompany()` faz `UPDATE profiles.current_company` + `router.refresh()` (fica na mesma página).
- **Lista de Notas:** `src/app/(auth)/notas_fiscais/page.tsx` busca com `.limit(50)` no server, sem filtro de data. `NotasFiscaisList.tsx` filtra no cliente (busca/tipo/status/período) via `useState`, **sem paginação**. Detalhe em `[id]/page.tsx` com Voltar = `<a href="/notas_fiscais">` fixo (perde filtro).
- **Lista de Clientes:** `src/app/(auth)/clientes/page.tsx` carrega tudo (sem limite); `src/components/ClientesListClient.tsx` filtra só por busca, **sem paginação**.
- **Honorários (padrão de referência):** `HonorarioList.tsx` já tem paginação client-side (100/pág, footer em cima e embaixo) e filtro de período pré-setado no mês vigente (helpers `primeiroDiaMesISO/ultimoDiaMesISO` em BRT). Componente reutilizável `src/components/FilterPeriodo.tsx`.
- **Regime/valores:** regime em `empresas_fiscais.Code_regime_tributario` (`1`/`2`/`3` = Simples, `4` = MEI — ver `src/lib/fiscal/regime.ts`). Notas em `notas_fiscais.valor_total` + `data_emissao`. Empresa ativa via `profiles.current_company`.

## Decisões (brainstorming)

1. **Métrica do limite:** soma do **ano-calendário** (Jan–Dez) das notas ativas.
2. **Limites:** MEI = R$ 81.000 · Simples (cód 1 e 2) = R$ 4.800.000 · Regime Normal (cód 3) = **banner oculto** (sem teto). 1º ano proporcional fora de escopo.
3. **Paginação das Notas:** client-side, igual Honorários (remove o `.limit(50)`).
4. **Filtros das Notas na URL** (searchParams) para o Voltar preservar o filtro.

---

## Ajuste 1 — Redirect ao trocar de empresa → Início

**Arquivo:** `src/components/MenuLateral.tsx` (`changeCompany`).

Após o `UPDATE` bem-sucedido de `current_company`, em vez de `router.refresh()`:
```ts
toast('success', 'Empresa alterada');
setCompanyMenuOpen(false);
router.push('/');     // Início
router.refresh();     // garante re-render do layout com a empresa nova (inclusive se já estava em '/')
```
Rota de Início confirmada = `/` (NAV: `{ href: '/', label: 'Início' }`).

---

## Ajuste 2 — Voltar da NF preserva o filtro (filtros na URL)

**Arquivos:** `NotasFiscaisList.tsx`, `notas_fiscais/[id]/page.tsx`.

- `NotasFiscaisList` passa a **derivar o estado inicial dos filtros de `useSearchParams()`**: `q`, `tipo`, `status`, `start`, `end`, `page`. Sem params → defaults (ver Ajuste 4 para `start`/`end`).
- A cada mudança de filtro/página, **sincroniza a URL** com `router.replace(\`?${qs}\`, { scroll: false })` (sem empilhar histórico, sem rolar a página). Só inclui na query os params que diferem do default, pra manter a URL limpa.
- `[id]/page.tsx`: o Voltar deixa de ser `<a href="/notas_fiscais">` e passa a usar **`router.back()`** (precisa virar/parcial client — um pequeno `BackButton` client component, já que a página de detalhe é server). Como a URL da lista carrega os filtros, `router.back()` retorna a ela e o estado é re-derivado da URL.

**Helper:** `src/app/(auth)/notas_fiscais/notas-filtros.ts` (puro, testável) com:
- `parseFiltrosFromParams(sp: URLSearchParams | Record<string,string|undefined>): Filtros` (aplica defaults).
- `filtrosToQueryString(f: Filtros): string` (omite defaults).
- tipo `Filtros = { q: string; tipo: string; status: string; start: string | null; end: string | null; page: number }`.

---

## Ajuste 3 — Paginação (100/pág, footer topo + rodapé) em Clientes e Notas

Espelha o padrão client-side do Honorários.

**Notas (`NotasFiscaisList.tsx`):**
- `page.tsx`: **remove o `.limit(50)`**. Mantém `order('data_emissao', { ascending:false })`. (Cap de segurança opcional alto, ex.: `.limit(2000)`, pra evitar carga patológica; documentado no card.)
- No cliente: `const POR_PAGINA = 100;` aplica os filtros → `filtered`, depois `slice` da página. `page` vem da URL (Ajuste 2).
- Footer de paginação renderizado **acima e abaixo** da tabela, dentro de `{totalPaginas > 1 && …}` (JSX copiado de `HonorarioList.tsx` 265–282 / 337–354). Trocar de página chama o sync da URL.

**Clientes (`ClientesListClient.tsx`):**
- Paginação client-side com `page` em `useState` (não há página de detalhe; não precisa de URL).
- `POR_PAGINA = 100`, footer topo + rodapé igual. Mantém a busca atual. Reset de página ao mudar a busca.
- (O `FilterPeriodo` importado-e-não-ligado em Clientes permanece fora de escopo.)

---

## Ajuste 4 — Filtro de mês vigente pré-setado nas Notas

**Arquivo:** `NotasFiscaisList.tsx` (+ helper de Ajuste 2).

- Defaults de `start`/`end` = primeiro/último dia do **mês corrente em BRT** (helpers `primeiroDiaMesISO/ultimoDiaMesISO`, copiados/extraídos do padrão do Honorários para um util compartilhável, ex.: `src/lib/format/mes-vigente.ts`).
- `parseFiltrosFromParams` usa esses defaults **só quando a URL não traz `start`/`end`** (primeira visita). Se a URL traz (voltei do detalhe, ou limpei o período), respeita a URL — inclusive período vazio explícito.
- Filtro aplicado por `data_emissao` (precisão de dia: `data_emissao.slice(0,10)` comparado com `start`/`end`).

---

## Ajuste 5 — Preview de limite de emissão (topo da lista de Notas)

**Métrica:** soma de `valor_total` das notas **ativas** (`status = 'ativa'`, `tipo_documento ∈ {NFe, NFCe, NFSe}`) com `data_emissao` no **ano-calendário atual** (BRT).

**Arquivos novos:**
- `src/lib/fiscal/limite-emissao.ts` (puro, testável):
  ```ts
  export type NivelLimite = 'verde' | 'amarelo' | 'vermelho';
  export type LimiteEmissao =
    | { mostrar: false }
    | { mostrar: true; limite: number; total: number; pct: number; nivel: NivelLimite; ano: number };

  const LIMITE_MEI = 81000;
  const LIMITE_SIMPLES = 4800000;

  export function limitePorRegime(code: string | null | undefined): number | null {
    if (code === '4') return LIMITE_MEI;          // MEI
    if (code === '1' || code === '2') return LIMITE_SIMPLES; // Simples (incl. excesso de sublimite)
    return null;                                   // Regime Normal (3) ou desconhecido → sem teto
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
- `src/app/(auth)/notas_fiscais/LimiteEmissaoBanner.tsx` (server component): recebe `LimiteEmissao` e renderiza, quando `mostrar`, um card com título *"Limite de emissão · {ano}"*, `R$ {total} / R$ {limite}`, barra de progresso (largura = `min(pct,100)%`) e cor pelo `nivel` (verde/amarelo/vermelho via classes Tailwind do tema). Quando `!mostrar`, não renderiza nada.

**Fetch (em `notas_fiscais/page.tsx`):**
- Lê `empresas_fiscais.Code_regime_tributario` da empresa ativa.
- Soma o emitido do ano: query `notas_fiscais` (`company_id`, `status='ativa'`, `tipo_documento in (...)`, `data_emissao >= {ano}-01-01`, `data_emissao < {ano+1}-01-01`) e soma `valor_total`. O fetch (DB) fica em um módulo **server-only** separado — `src/lib/fiscal/emitido-ano.ts` com `somarEmitidoNoAno(supabase, companyId, ano): Promise<number>` — para manter `limite-emissao.ts` puro (sem dependência de Supabase). A página chama `somarEmitidoNoAno` e passa o total para `calcularLimiteEmissao`.
- Passa `calcularLimiteEmissao(code, total, ano)` ao `<LimiteEmissaoBanner>`, renderizado **acima** de `<NotasFiscaisList>`.

**Cores:** `pct ≤ 60` 🟢 verde · `60 < pct ≤ 80` 🟡 amarelo · `pct > 80` 🔴 vermelho.

**Layout (referência):**
```
┌─────────────────────────────────────────────────────────┐
│ Limite de emissão · 2026          R$ 45.000 / R$ 81.000  │
│ ████████████████░░░░░░░░░░░░░░  56%                       │
└─────────────────────────────────────────────────────────┘
```

---

## Testes

- `src/lib/fiscal/limite-emissao.test.ts`:
  - `limitePorRegime`: `'4'`→81000; `'1'`/`'2'`→4800000; `'3'`/`null`/`'9'`→null.
  - `nivelPorPct`: 0/60→verde; 61/80→amarelo; 81/100/120→vermelho (limites de faixa exatos: 60 verde, 80 amarelo).
  - `calcularLimiteEmissao`: MEI 56% verde; Simples >80% vermelho; Regime Normal → `{mostrar:false}`; pct>100 (estouro) → vermelho e barra capada a 100%.
- `src/app/(auth)/notas_fiscais/notas-filtros.test.ts`:
  - `parseFiltrosFromParams`: sem params → mês vigente + defaults; com params → respeita (incl. período vazio explícito); `page` parseado/saneado (≥1).
  - `filtrosToQueryString`: omite defaults; round-trip parse→stringify→parse estável.
- Demais ajustes (redirect, footer de paginação, `router.back()`) = navegação/UI → cobertos por revisão + smoke manual.

## Tratamento de erros / bordas

- Soma do ano sem notas → `total = 0`, `pct = 0`, verde.
- `valor_total` nulo → ignorado na soma.
- Regime ausente/desconhecido → banner oculto (não quebra a página).
- Estouro (`pct > 100`) → nível vermelho; barra visual capada a 100%.
- URL com params inválidos → `parseFiltrosFromParams` cai nos defaults (não lança).

## Sequência de PRs (revisão PR a PR)

1. **PR A** — Redirect ao trocar de empresa (Ajuste 1). Menor, isolado.
2. **PR B** — `limite-emissao.ts` + `LimiteEmissaoBanner` + fetch no `page.tsx` (Ajuste 5).
3. **PR C** — Filtros das Notas na URL + `router.back()` no detalhe + mês vigente default (Ajustes 2 e 4, acoplados pelo helper `notas-filtros.ts`).
4. **PR D** — Paginação das Notas (Ajuste 3, depende de C pela `page` na URL).
5. **PR E** — Paginação dos Clientes (Ajuste 3, independente).

## Fora de escopo (YAGNI)

- Paginação/filtros server-side (range/offset) — fica client-side igual Honorários.
- Ligar o `FilterPeriodo` em Clientes (importado mas não usado hoje).
- Filtro de data default em Clientes (só Notas foi pedido).
- 1º ano proporcional do MEI / tolerância de 20% do Simples no cálculo de estouro.
- Persistir paginação dos Clientes na URL.
