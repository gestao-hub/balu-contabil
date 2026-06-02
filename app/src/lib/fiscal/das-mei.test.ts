import { describe, it, expect } from 'vitest';
import { valorDasMei } from './das-mei';

describe('valorDasMei', () => {
  it('comércio ou indústria', () => {
    expect(valorDasMei('Comercio ou Industria')).toBe(76.90);
  });
  it('prestação de serviços', () => {
    expect(valorDasMei('Prestacao de Servicos')).toBe(80.90);
  });
  it('comércio e serviços', () => {
    expect(valorDasMei('Comercio e Servicos')).toBe(81.90);
  });
  it('desconhecido/null → default serviços', () => {
    expect(valorDasMei(null)).toBe(80.90);
    expect(valorDasMei('xpto')).toBe(80.90);
  });
});
