import { describe, it, expect } from 'vitest';
import { calcularFatorR, LIMIAR_FATOR_R } from './fator-r';

describe('calcularFatorR', () => {
  it('>= 28% decide Anexo III', () => {
    const r = calcularFatorR({ folha12m: 3000, rbt12: 10000 }); // 30%
    expect(r.suficiente).toBe(true);
    expect(r.fatorR).toBeCloseTo(0.3, 5);
    expect(r.anexoDecidido).toBe('Anexo III');
  });

  it('< 28% decide Anexo V', () => {
    const r = calcularFatorR({ folha12m: 2000, rbt12: 10000 }); // 20%
    expect(r.suficiente).toBe(true);
    expect(r.anexoDecidido).toBe('Anexo V');
  });

  it('exatamente 28% decide Anexo III (fronteira inclusiva)', () => {
    const r = calcularFatorR({ folha12m: 2800, rbt12: 10000 }); // 28%
    expect(r.fatorR).toBeCloseTo(LIMIAR_FATOR_R, 5);
    expect(r.anexoDecidido).toBe('Anexo III');
  });

  it('rbt12 = 0 → insuficiente', () => {
    const r = calcularFatorR({ folha12m: 3000, rbt12: 0 });
    expect(r.suficiente).toBe(false);
    expect(r.fatorR).toBeNull();
    expect(r.anexoDecidido).toBeNull();
  });

  it('folha = 0 → insuficiente', () => {
    const r = calcularFatorR({ folha12m: 0, rbt12: 10000 });
    expect(r.suficiente).toBe(false);
    expect(r.anexoDecidido).toBeNull();
  });
});
