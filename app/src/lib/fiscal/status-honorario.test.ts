import { describe, it, expect } from 'vitest';
import { statusHonorario } from './status-honorario';

describe('statusHonorario', () => {
  const hoje = new Date('2026-07-22T12:00:00Z');

  it('pago quando há data_pagamento, mesmo que vencido', () => {
    const r = statusHonorario({ data_pagamento: '2026-07-20', data_vencimento: '2026-07-01' }, hoje);
    expect(r).toBe('pago');
  });

  it('atrasado quando não pago e vencimento < hoje', () => {
    const r = statusHonorario({ data_pagamento: null, data_vencimento: '2026-07-21' }, hoje);
    expect(r).toBe('atrasado');
  });

  it('aberto quando não pago e vencimento >= hoje', () => {
    const r = statusHonorario({ data_pagamento: null, data_vencimento: '2026-07-22' }, hoje);
    expect(r).toBe('aberto');
  });
});
