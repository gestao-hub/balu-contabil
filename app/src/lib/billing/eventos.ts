// Bloco 4A — traducao do vocabulario do Asaas para o nosso. Puro, sem I/O.
//
// POR QUE TRADUZIR NA BORDA: espelhar cru o vocabulario do provedor faria
// uma mudanca de nomenclatura dele virar mudanca de regra de negocio no app
// inteiro. Aqui o resto do sistema so conhece os nossos nomes.

export type TipoEfeito =
  | 'pagamento_confirmado'
  | 'cobranca_vencida'
  | 'cobranca_criada'
  | 'estorno';

export type EfeitoEvento =
  | { tipo: TipoEfeito; chargeId: string; subscriptionId: string | null }
  | { tipo: 'ignorado'; motivo: 'evento_desconhecido' | 'payload_invalido' };

const MAPA: Record<string, TipoEfeito> = {
  PAYMENT_CREATED:   'cobranca_criada',
  PAYMENT_RECEIVED:  'pagamento_confirmado',
  PAYMENT_CONFIRMED: 'pagamento_confirmado',
  PAYMENT_OVERDUE:   'cobranca_vencida',
  PAYMENT_REFUNDED:  'estorno',
};

export function traduzirEvento(payload: unknown): EfeitoEvento {
  if (typeof payload !== 'object' || payload === null) {
    return { tipo: 'ignorado', motivo: 'payload_invalido' };
  }
  const p = payload as { event?: unknown; payment?: { id?: unknown; subscription?: unknown } };
  if (typeof p.event !== 'string') return { tipo: 'ignorado', motivo: 'payload_invalido' };

  const tipo = MAPA[p.event];
  // Nunca cair num default que interprete: vocabulario novo do provedor nao
  // pode bloquear cliente adimplente nem liberar inadimplente.
  if (!tipo) return { tipo: 'ignorado', motivo: 'evento_desconhecido' };

  const chargeId = p.payment?.id;
  if (typeof chargeId !== 'string' || !chargeId) {
    return { tipo: 'ignorado', motivo: 'payload_invalido' };
  }
  const sub = p.payment?.subscription;
  const subscriptionId = typeof sub === 'string' && sub ? sub : null;

  return { tipo, chargeId, subscriptionId };
}
