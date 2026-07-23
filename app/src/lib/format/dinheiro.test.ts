import { describe, it, expect } from 'vitest';
import { valorToCentavos, centavosToValor, formatBRL, normalizarValorBRL } from './dinheiro';

describe('dinheiro', () => {
  it('valorToCentavos evita float (199.9 -> 19990)', () => {
    expect(valorToCentavos('199.90')).toBe(19990);
    expect(valorToCentavos('0.1')).toBe(10);
    expect(valorToCentavos(1234.56)).toBe(123456);
  });
  it('centavosToValor round-trip', () => {
    expect(centavosToValor(19990)).toBe('199.90');
  });
  describe('normalizarValorBRL', () => {
    it('formato BR com milhar e decimal', () => {
      expect(normalizarValorBRL('1.200,00')).toBe('1200.00');
      expect(normalizarValorBRL('1.200.000,50')).toBe('1200000.50');
      expect(normalizarValorBRL('R$ 1.500,00')).toBe('1500.00');
    });
    it('só vírgula decimal', () => {
      expect(normalizarValorBRL('1200,5')).toBe('1200.5');
      expect(normalizarValorBRL('0,99')).toBe('0.99');
    });
    it('ponto único: decimal com 1-2 casas, milhar com 3', () => {
      expect(normalizarValorBRL('1200.50')).toBe('1200.50');
      expect(normalizarValorBRL('1.200')).toBe('1200'); // milhar, não 1.20
    });
    it('inteiro simples e vazio', () => {
      expect(normalizarValorBRL('1200')).toBe('1200');
      expect(normalizarValorBRL('  ')).toBe('');
      expect(normalizarValorBRL('abc')).toBe('');
    });
  });
  it('formatBRL', () => {
    // NBSP (U+00A0) entre "R$" e o valor -- comportamento real do Intl/toLocaleString.
    expect(formatBRL(19990)).toBe('R$ 199,90');
  });
});
