// @custom — Fonte única dos tipos de notificação (label + severidade padrão).
//
// Uma RPC em Postgres replica esses mesmos valores em SQL; o cron e a UI
// importam este helper. `abertura_etapa` já está incluído aqui porque o
// Bloco 2 (andamento de abertura) vai reutilizá-lo.

export type Severidade = 'info' | 'warning' | 'danger';

export type NotificacaoTipo =
  | 'das_a_vencer'
  | 'das_vencido'
  | 'pgdas_pendente'
  | 'dasn_pendente'
  | 'defis_pendente'
  | 'cert_a_vencer'
  | 'cert_vencido'
  | 'limite_faturamento'
  | 'honorario_a_vencer'
  | 'abertura_etapa'; // Bloco 2

export const NOTIFICACAO_TIPOS: Record<NotificacaoTipo, { label: string; severidade: Severidade }> = {
  das_a_vencer: { label: 'DAS a vencer', severidade: 'warning' },
  das_vencido: { label: 'DAS vencido', severidade: 'danger' },
  pgdas_pendente: { label: 'Declaração mensal (PGDAS-D) pendente', severidade: 'warning' },
  dasn_pendente: { label: 'Declaração anual do MEI (DASN-SIMEI) pendente', severidade: 'warning' },
  defis_pendente: { label: 'Declaração anual do Simples (DEFIS) pendente', severidade: 'warning' },
  cert_a_vencer: { label: 'Certificado digital A1 vencendo', severidade: 'warning' },
  cert_vencido: { label: 'Certificado digital A1 vencido', severidade: 'danger' },
  limite_faturamento: { label: 'Limite de faturamento', severidade: 'warning' },
  honorario_a_vencer: { label: 'Honorário a vencer', severidade: 'info' },
  abertura_etapa: { label: 'Andamento da abertura', severidade: 'info' },
};

export const TIPOS_VALIDOS = Object.keys(NOTIFICACAO_TIPOS) as NotificacaoTipo[];

export function severidadePadrao(tipo: NotificacaoTipo): Severidade {
  return NOTIFICACAO_TIPOS[tipo].severidade;
}
