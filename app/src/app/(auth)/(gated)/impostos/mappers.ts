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
