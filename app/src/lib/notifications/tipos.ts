// @custom — Fonte única dos tipos de notificação (label + severidade padrão).
//
// Uma RPC em Postgres replica esses mesmos valores em SQL; o cron e a UI
// importam este helper. `abertura_etapa` já está incluído aqui porque o
// Bloco 2 (andamento de abertura) vai reutilizá-lo.
//
// ⚠️ ESTE ARQUIVO E O `CHECK` DE `notifications.tipo` SÃO A MESMA LISTA.
// Em 13/08/2026 a análise da Frente 3 encontrou o arquivo com 11 tipos e o
// banco aceitando 16: os cinco de fora chegavam ao usuário e não apareciam na
// tela de preferências — ele recebia avisos que não tinha como desligar, nem
// sabia que existiam. `tipos.test.ts` compara as duas listas justamente para
// que o sexto órfão não passe em silêncio.

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
  | 'abertura_etapa' // Bloco 2
  | 'assinatura_trial_acabando' // 0050 — billing
  | 'assinatura_cobranca_vencida' // 0050 — billing
  | 'whatsapp_escalado' // 0061 — atendimento
  | 'sla_estourado' // 0070 — SLA
  | 'pagamento_nao_detectado' // 0071 — conciliação
  | 'parametro_fiscal_desatualizado' // 0081 — só para AdminBalu
  | 'pagamento_confirmado'; // 0086 — Frente 3 (Receita e Asaas)

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
  // Severidades abaixo conferidas contra quem realmente insere cada tipo, não
  // escolhidas aqui: billing/cron.ts:352, uazapi/route.ts:117, 0070:116 e
  // conciliacao/cron.ts:189 gravam todas 'warning'.
  assinatura_trial_acabando: { label: 'Período de teste acabando', severidade: 'warning' },
  // Declarado no CHECK desde a 0050 e, até hoje, sem nenhum emissor no código —
  // o que insere inadimplência é o webhook, mudando o status da assinatura.
  // Fica listado para a tela de preferências não mentir sobre o que o banco
  // aceita; se ganhar emissor, conferir a severidade lá antes de mudar aqui.
  assinatura_cobranca_vencida: { label: 'Cobrança da assinatura vencida', severidade: 'danger' },
  whatsapp_escalado: { label: 'Atendimento escalado para humano', severidade: 'warning' },
  sla_estourado: { label: 'Prazo de atendimento (SLA) estourado', severidade: 'warning' },
  pagamento_nao_detectado: { label: 'Pagamento de guia não identificado', severidade: 'warning' },
  parametro_fiscal_desatualizado: { label: 'Parâmetro fiscal desatualizado', severidade: 'warning' },
  pagamento_confirmado: { label: 'Pagamento confirmado', severidade: 'info' },
};

export const TIPOS_VALIDOS = Object.keys(NOTIFICACAO_TIPOS) as NotificacaoTipo[];

/**
 * Os tipos que a tela de preferências oferece — e o porquê de cada ausência.
 *
 * Antes isto era um `filter` solto na tela (`t !== 'abertura_etapa'`). Com os
 * cinco órfãos entrando de uma vez, a exclusão passou para cá: a decisão de
 * "quem o usuário pode silenciar" é da fonte única, não do JSX, e cada exceção
 * precisa de motivo escrito.
 *
 * - `abertura_etapa`: transacional do Bloco 2 — é o andamento do pedido que a
 *   pessoa abriu, não um alerta recorrente.
 * - `parametro_fiscal_desatualizado`: destinatário é AdminBalu (0081). Listar
 *   para todo mundo ofereceria desligar um e-mail que aquele usuário nunca vai
 *   receber.
 */
const TIPOS_FORA_DAS_PREFERENCIAS: NotificacaoTipo[] = [
  'abertura_etapa',
  'parametro_fiscal_desatualizado',
];

export const TIPOS_PREFERENCIAVEIS = TIPOS_VALIDOS.filter(
  (t) => !TIPOS_FORA_DAS_PREFERENCIAS.includes(t),
);

export function severidadePadrao(tipo: NotificacaoTipo): Severidade {
  return NOTIFICACAO_TIPOS[tipo].severidade;
}
