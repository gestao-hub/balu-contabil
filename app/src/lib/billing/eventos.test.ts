import { describe, it, expect } from 'vitest';
import { traduzirEvento } from './eventos';

const pagamento = (event: string) => ({
  event,
  payment: {
    id: 'pay_123',
    subscription: 'sub_9',
    value: 49.9,
    dueDate: '2026-08-10',
    status: 'RECEIVED',
    invoiceUrl: 'https://asaas/i/123',
  },
});

describe('traduzirEvento', () => {
  it('PAYMENT_RECEIVED vira pagamento confirmado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_RECEIVED'))).toEqual({
      tipo: 'pagamento_confirmado', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_CONFIRMED tambem vira pagamento confirmado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_CONFIRMED'))).toEqual({
      tipo: 'pagamento_confirmado', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_OVERDUE vira cobranca vencida', () => {
    expect(traduzirEvento(pagamento('PAYMENT_OVERDUE'))).toEqual({
      tipo: 'cobranca_vencida', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_CREATED vira cobranca criada', () => {
    expect(traduzirEvento(pagamento('PAYMENT_CREATED'))).toEqual({
      tipo: 'cobranca_criada', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_REFUNDED vira estorno', () => {
    expect(traduzirEvento(pagamento('PAYMENT_REFUNDED'))).toEqual({
      tipo: 'estorno', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('cobranca avulsa (sem subscription) traduz com subscriptionId null', () => {
    expect(traduzirEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).toEqual({
      tipo: 'pagamento_confirmado', chargeId: 'pay_1', subscriptionId: null,
    });
  });

  // DISCRIMINANTE DE SEGURANCA: um vocabulario novo do provedor NAO pode
  // virar bloqueio silencioso de cliente adimplente nem liberacao de
  // inadimplente. Sem este caso, um `default: cobranca_vencida` passaria.
  it('evento desconhecido e ignorado, nunca interpretado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_ANTICIPATED_XYZ')))
      .toEqual({ tipo: 'ignorado', motivo: 'evento_desconhecido' });
  });

  it('payload sem event e ignorado', () => {
    expect(traduzirEvento({ foo: 'bar' }))
      .toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });

  it('payload nao-objeto e ignorado', () => {
    expect(traduzirEvento(null)).toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });

  it('evento de pagamento sem id de cobranca e ignorado', () => {
    expect(traduzirEvento({ event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub_9' } }))
      .toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });
});
