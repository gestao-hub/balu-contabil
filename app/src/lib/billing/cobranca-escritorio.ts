// Bloco 4B — persistencia das cobrancas do escritorio.
//
// Espelha lib/billing/cobranca.ts do 4A, mas em tabela separada: aquilo e
// dinheiro da Balu, isto e dinheiro do escritorio, e a separacao vale no banco.
//
// PURO DE PROPOSITO — zero import, zero I/O, zero `server-only`. Tres lugares
// diferentes decidem o mesmo estado a partir do mesmo evento: o webhook
// (api/webhooks/asaas/route.ts), a reconciliacao diaria (lib/billing/cron.ts) e
// a tela. Se a regra "evento fora de ordem nao desfaz pagamento" morasse em
// qualquer um deles, os outros dois teriam a sua propria versao dela — e o
// Asaas REENTREGA e REORDENA eventos. Isso ja mordeu este projeto no 4A.

export type StatusCobranca = 'pendente' | 'paga' | 'vencida' | 'estornada';

/** Os quatro valores acima sao exatamente o CHECK
 *  `cobrancas_escritorio_status_check` da migration 0053. */
const MAPA: Record<string, StatusCobranca> = {
  PENDING: 'pendente', AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'paga', CONFIRMED: 'paga', RECEIVED_IN_CASH: 'paga',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada', REFUND_REQUESTED: 'estornada', CHARGEBACK_REQUESTED: 'estornada',
};

/** Status desconhecido vira `pendente` de propósito: inventar um estado a
 *  partir de string nova do Asaas seria pior que ficar no mais conservador —
 *  e `pendente` é o único dos quatro que não afirma nada sobre o dinheiro. */
export function statusDoAsaas(s: string): StatusCobranca {
  return MAPA[s] ?? 'pendente';
}

/**
 * O que gravar, ou `null` quando não há nada a mudar.
 *
 * O Asaas **reentrega** eventos e não garante ordem. Sem esta função, um
 * `OVERDUE` atrasado chegando depois do `RECEIVED` marcaria como vencida uma
 * cobrança já paga — e o cliente seria cobrado de novo por algo que pagou.
 */
export function aplicarEventoNaCobranca(
  atual: { status: string; pago_em: string | null },
  evento: { status: StatusCobranca; pagoEm: string | null },
): { status: StatusCobranca; pago_em: string | null } | null {
  // Reentrega exata do mesmo evento: nada a escrever, e nada a revalidar.
  if (atual.status === evento.status && (atual.pago_em ?? null) === (evento.pagoEm ?? null)) return null;

  // Estorno é o ÚNICO evento que pode desfazer um pagamento: é o próprio
  // Asaas dizendo que o dinheiro voltou.
  if (atual.status === 'paga' && evento.status !== 'estornada') return null;

  return { status: evento.status, pago_em: evento.status === 'paga' ? evento.pagoEm : null };
}
