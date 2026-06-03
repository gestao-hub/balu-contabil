import { describe, it, expect } from 'vitest';
import { limitePorRegime, nivelPorPct, calcularLimiteEmissao } from './limite-emissao';

describe('limitePorRegime', () => {
  it('MEI (4) → 81000', () => expect(limitePorRegime('4')).toBe(81000));
  it('Simples (1 e 2) → 4800000', () => {
    expect(limitePorRegime('1')).toBe(4800000);
    expect(limitePorRegime('2')).toBe(4800000);
  });
  it('Regime Normal (3) / nulo / desconhecido → null', () => {
    expect(limitePorRegime('3')).toBeNull();
    expect(limitePorRegime(null)).toBeNull();
    expect(limitePorRegime(undefined)).toBeNull();
    expect(limitePorRegime('9')).toBeNull();
  });
});

describe('nivelPorPct', () => {
  it('≤60 verde', () => {
    expect(nivelPorPct(0)).toBe('verde');
    expect(nivelPorPct(60)).toBe('verde');
  });
  it('61–80 amarelo', () => {
    expect(nivelPorPct(61)).toBe('amarelo');
    expect(nivelPorPct(80)).toBe('amarelo');
  });
  it('>80 vermelho', () => {
    expect(nivelPorPct(81)).toBe('vermelho');
    expect(nivelPorPct(100)).toBe('vermelho');
    expect(nivelPorPct(120)).toBe('vermelho');
  });
});

describe('calcularLimiteEmissao', () => {
  it('MEI 56% → verde, mostrar', () => {
    const r = calcularLimiteEmissao('4', 45000, 2026);
    expect(r).toEqual({ mostrar: true, limite: 81000, total: 45000, pct: 56, nivel: 'verde', ano: 2026 });
  });
  it('Simples acima de 80% → vermelho', () => {
    const r = calcularLimiteEmissao('1', 4000000, 2026);
    expect(r.mostrar).toBe(true);
    if (r.mostrar) {
      expect(r.pct).toBe(83);
      expect(r.nivel).toBe('vermelho');
    }
  });
  it('Regime Normal → não mostra', () => {
    expect(calcularLimiteEmissao('3', 999999, 2026)).toEqual({ mostrar: false });
  });
  it('estouro (pct>100) → vermelho', () => {
    const r = calcularLimiteEmissao('4', 90000, 2026);
    expect(r.mostrar).toBe(true);
    if (r.mostrar) {
      expect(r.pct).toBe(111);
      expect(r.nivel).toBe('vermelho');
    }
  });
});
