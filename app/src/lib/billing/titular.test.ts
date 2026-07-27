import { describe, it, expect } from 'vitest';
import { titularDaEmpresa } from './titular';

describe('titularDaEmpresa', () => {
  it('empresa sem contabilidade responde pela propria assinatura', () => {
    expect(titularDaEmpresa({ id: 'c1', contabilidade_id: null }))
      .toEqual({ tipo: 'company', id: 'c1' });
  });

  it('empresa de carteira e coberta pelo escritorio', () => {
    expect(titularDaEmpresa({ id: 'c1', contabilidade_id: 'e9' }))
      .toEqual({ tipo: 'coberta_por_escritorio', id: 'e9' });
  });
});
