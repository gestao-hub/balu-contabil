import { describe, it, expect } from 'vitest';
import { identificarFaixa, aliquotaEfetiva, getTabelaSimples, TABELA_SIMPLES_FALLBACK } from './simples';

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

describe('tabela vinda do banco (0079)', () => {
  const dobrada = {
    ...TABELA_SIMPLES_FALLBACK,
    'Anexo I': TABELA_SIMPLES_FALLBACK['Anexo I'].map((f) => ({ ...f, nominal: f.nominal * 2 })),
  };

  it('a tabela passada substitui o fallback', () => {
    expect(identificarFaixa(100000, 'Anexo I', '202601', dobrada).nominal).toBe(0.08);
  });

  it('sem tabela (ou null) usa o fallback do módulo', () => {
    // O SELECT pode falhar; o imposto não pode sumir junto.
    expect(identificarFaixa(100000, 'Anexo I', '202601').nominal).toBe(0.04);
    expect(identificarFaixa(100000, 'Anexo I', '202601', null).nominal).toBe(0.04);
    expect(getTabelaSimples('202601', null)).toBe(TABELA_SIMPLES_FALLBACK);
  });

  it('a tabela do banco chega até a alíquota efetiva', () => {
    const faixa = identificarFaixa(200000, 'Anexo I', '202601', dobrada); // 14,6% / 5940
    expect(aliquotaEfetiva(200000, faixa)).toBeCloseTo((200000 * 0.146 - 5940) / 200000, 6);
  });
});
