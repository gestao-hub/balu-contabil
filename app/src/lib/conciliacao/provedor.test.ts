import { describe, it, expect, afterEach } from 'vitest';
import { conciliacaoDisponivel } from './provedor';

const ANTES = process.env.OPEN_FINANCE_PROVEDOR;
afterEach(() => {
  if (ANTES === undefined) delete process.env.OPEN_FINANCE_PROVEDOR;
  else process.env.OPEN_FINANCE_PROVEDOR = ANTES;
});

describe('conciliacaoDisponivel', () => {
  it('sem provedor configurado => indisponível (estado de hoje)', () => {
    delete process.env.OPEN_FINANCE_PROVEDOR;
    expect(conciliacaoDisponivel()).toBe(false);
  });

  it('provedor "mock" NÃO conta como disponível', () => {
    // O mock lê uma tabela nossa. Oferecer conexão bancária com ele seria
    // prometer ao cliente uma vigilância que não existe.
    process.env.OPEN_FINANCE_PROVEDOR = 'mock';
    expect(conciliacaoDisponivel()).toBe(false);
  });

  it('provedor real => disponível', () => {
    process.env.OPEN_FINANCE_PROVEDOR = 'pluggy';
    expect(conciliacaoDisponivel()).toBe(true);
  });
});
