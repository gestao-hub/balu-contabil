import { describe, it, expect } from 'vitest';
import { valorToCentavos, centavosToValor, formatBRL } from './dinheiro';

describe('dinheiro', () => {
  it('valorToCentavos evita float (199.9 -> 19990)', () => {
    expect(valorToCentavos('199.90')).toBe(19990);
    expect(valorToCentavos('0.1')).toBe(10);
    expect(valorToCentavos(1234.56)).toBe(123456);
  });
  it('centavosToValor round-trip', () => {
    expect(centavosToValor(19990)).toBe('199.90');
  });
  it('formatBRL', () => {
    // NBSP (U+00A0) entre "R$" e o valor -- comportamento real do Intl/toLocaleString.
    expect(formatBRL(19990)).toBe('R$ 199,90');
  });
});
