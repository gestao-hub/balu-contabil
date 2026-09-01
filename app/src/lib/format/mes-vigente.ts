// Primeiro/último dia do mês corrente em BRT, em ISO 'YYYY-MM-DD'.
//
// ─── POR QUE NÃO É `Date.now() - 3h` ────────────────────────────────────────
// A versão anterior fazia `new Date(Date.now() - 3h)` e lia com
// `.getFullYear()` / `.getMonth()` — que são getters de hora LOCAL. Isso só
// devolve BRT quando o processo roda em UTC:
//
//   em 2026-09-01T04:00:00Z (01:00 em Brasília)
//     servidor (Vercel, TZ=UTC)          → "2026-09-01"   ✔
//     navegador brasileiro (TZ=BRT)      → "2026-08-01"   ✘  (subtrai 3h DUAS vezes)
//
// Duas consequências, e as duas foram medidas em 01/09/2026:
//   1. nas primeiras 3 horas de todo mês, a lista de notas do usuário abre
//      filtrada no mês ANTERIOR — uma nota emitida 00:30 fica invisível;
//   2. servidor e cliente produzem strings diferentes, e `notas-filtros.ts` é
//      lido dentro do `'use client'` `NotasFiscaisList`: é o erro React #418 de
//      hidratação (BUG-006) voltando pela porta dos fundos, no mesmo dia em que
//      `data-brt.ts` foi escrito para fechá-la.
//
// A saída é a mesma daquele módulo: fuso FIXO em `America/Sao_Paulo`, resolvido
// pelo `Intl`, que não depende de onde o código roda. `en-CA` porque o formato
// dele já é `YYYY-MM-DD`.
//
// ⚠️ `now` é injetável só para teste. O teste antigo comparava o helper com uma
// reimplementação da mesma conta errada, então não tinha como pegar isto.

const FUSO = 'America/Sao_Paulo';

const fAnoMes = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit',
});

/** `{ ano, mes }` do instante, no calendário de Brasília. */
function anoMesBrt(now: Date): { ano: number; mes: number } {
  const p = Object.fromEntries(fAnoMes.formatToParts(now).map((x) => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month) };
}

export function primeiroDiaMesISO(now: Date = new Date()): string {
  const { ano, mes } = anoMesBrt(now);
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

export function ultimoDiaMesISO(now: Date = new Date()): string {
  const { ano, mes } = anoMesBrt(now);
  // `Date.UTC(ano, mes, 0)` = último dia do mês `mes` (índice 1-based aqui, o
  // que faz o dia 0 cair no fim do mês anterior). Em UTC de propósito: é
  // aritmética de calendário sobre números que já vieram de BRT, e passar pelo
  // fuso local aqui reintroduziria a dependência que este módulo acabou de tirar.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
}
