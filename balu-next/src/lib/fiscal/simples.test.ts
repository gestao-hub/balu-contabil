import { describe, it, expect } from 'vitest';
import { identificarFaixa, aliquotaEfetiva, getTabelaSimples } from './simples';

describe('identificarFaixa', () => {
  it('faixa 1 no limite inferior', () => {
    expect(identificarFaixa(100000, 'Anexo I').faixa).toBe(1);
  });
  it('boundary: exatamente 180000 ainda é faixa 1', () => {
    expect(identificarFaixa(180000, 'Anexo I').faixa).toBe(1);
  });
  it('boundary: 180000.01 vira faixa 2', () => {
    expect(identificarFaixa(180000.01, 'Anexo I').faixa).toBe(2);
  });
  it('acima do teto cai na última faixa (6)', () => {
    expect(identificarFaixa(99_000_000, 'Anexo III').faixa).toBe(6);
  });
});

describe('aliquotaEfetiva', () => {
  it('faixa 1 sem dedução = nominal', () => {
    const faixa = identificarFaixa(100000, 'Anexo I'); // 4%
    expect(aliquotaEfetiva(100000, faixa)).toBeCloseTo(0.04, 4);
  });
  it('Anexo I faixa 2: RBT12 200k → 4,33%', () => {
    const faixa = identificarFaixa(200000, 'Anexo I'); // 7,3% / 5940
    expect(aliquotaEfetiva(200000, faixa)).toBeCloseTo(0.0433, 3);
  });
  it('clamp: nunca negativa', () => {
    const faixa = { faixa: 2, ate: 360000, nominal: 0.073, deduzir: 999999 };
    expect(aliquotaEfetiva(200000, faixa)).toBe(0);
  });
  it('rbt12 = 0 → alíquota 0 (sem divisão por zero)', () => {
    const faixa = identificarFaixa(0, 'Anexo I');
    expect(aliquotaEfetiva(0, faixa)).toBe(0);
  });
});

describe('getTabelaSimples', () => {
  it('Anexo III faixa 1 = 6%', () => {
    expect(getTabelaSimples('202601')['Anexo III'][0].nominal).toBe(0.06);
  });
});
