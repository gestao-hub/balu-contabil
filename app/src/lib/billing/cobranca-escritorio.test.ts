import { describe, it, expect } from 'vitest';
import { aplicarEventoNaCobranca, statusDoAsaas } from './cobranca-escritorio';

describe('statusDoAsaas', () => {
  it.each([
    ['PENDING', 'pendente'], ['RECEIVED', 'paga'], ['CONFIRMED', 'paga'],
    ['OVERDUE', 'vencida'], ['REFUNDED', 'estornada'],
  ])('%s vira %s', (asaas, esperado) => {
    expect(statusDoAsaas(asaas)).toBe(esperado);
  });

  it('status desconhecido nao inventa: fica pendente', () => {
    expect(statusDoAsaas('COISA_NOVA')).toBe('pendente');
  });

  // Os quatro valores que saem daqui sao exatamente os do CHECK
  // `cobrancas_escritorio_status_check` da 0053: um quinto valor viraria erro
  // de Postgres no webhook, longe de quem poderia entender.
  it('so emite os quatro status que o banco aceita', () => {
    const emitidos = new Set(
      ['PENDING', 'AWAITING_RISK_ANALYSIS', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH',
        'OVERDUE', 'REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'QUALQUER_COISA']
        .map(statusDoAsaas),
    );
    expect([...emitidos].sort()).toEqual(['estornada', 'paga', 'pendente', 'vencida']);
  });
});

describe('aplicarEventoNaCobranca', () => {
  const paga = { status: 'paga', pago_em: '2026-07-20' };

  // A mesma regra de nao-regressao do 4A: o Asaas REENTREGA eventos, e um
  // 'vencida' que chega depois do 'paga' nao pode desfazer o pagamento.
  it('evento fora de ordem nao desfaz um pagamento', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'vencida', pagoEm: null })).toBeNull();
  });

  it('pendente reentregue depois do pagamento tambem nao desfaz', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'pendente', pagoEm: null })).toBeNull();
  });

  it('pagamento sobrescreve pendente', () => {
    const r = aplicarEventoNaCobranca({ status: 'pendente', pago_em: null }, { status: 'paga', pagoEm: '2026-07-20' });
    expect(r).toEqual({ status: 'paga', pago_em: '2026-07-20' });
  });

  it('pagamento sobrescreve vencida — quem venceu e pagou depois esta pago', () => {
    const r = aplicarEventoNaCobranca({ status: 'vencida', pago_em: null }, { status: 'paga', pagoEm: '2026-07-25' });
    expect(r).toEqual({ status: 'paga', pago_em: '2026-07-25' });
  });

  it('estorno DESFAZ o pagamento — e o unico que pode', () => {
    const r = aplicarEventoNaCobranca(paga, { status: 'estornada', pagoEm: null });
    expect(r).toEqual({ status: 'estornada', pago_em: null });
  });

  it('reentrega do mesmo evento nao gera atualizacao', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'paga', pagoEm: '2026-07-20' })).toBeNull();
  });

  // `pago_em` so existe quando ha pagamento. Um evento nao-pago que chegasse
  // com data deixaria a linha dizendo "vencida, paga em 20/07".
  it('status nao-pago nunca carrega pago_em, mesmo se o evento trouxer data', () => {
    const r = aplicarEventoNaCobranca({ status: 'pendente', pago_em: null }, { status: 'vencida', pagoEm: '2026-07-20' });
    expect(r).toEqual({ status: 'vencida', pago_em: null });
  });

  // Fixar o comportamento, que nao e obvio: uma cobranca JA PAGA e imutavel
  // para tudo que nao seja estorno — inclusive para uma segunda confirmacao com
  // outra data. Quando o Asaas reentrega RECEIVED e depois CONFIRMED, as datas
  // costumam diferir, e ficar reescrevendo `pago_em` so gera escrita e
  // revalidacao a toa sobre um fato que ja esta decidido.
  it('segunda confirmacao com data diferente NAO reescreve o pagamento', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'paga', pagoEm: '2026-07-21' })).toBeNull();
  });
});
