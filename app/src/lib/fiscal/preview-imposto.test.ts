import { describe, it, expect } from 'vitest';
import { montarPreview } from './preview-imposto';
import type { ReceitaApuracao } from './apuracao-types';

describe('montarPreview', () => {
  it('Simples com anexo → {tipo:simples, aliquota>0}', () => {
    const receitas: ReceitaApuracao[] = [
      { competencia: '202605', valor: 100000 },
      { competencia: '202606', valor: 5000 },
    ];
    const r = montarPreview({ regimeCode: '1', anexo: 'Anexo I', receitas, competencia: '202606' });
    expect(r.tipo).toBe('simples');
    if (r.tipo === 'simples') {
      expect(r.aliquota).toBeGreaterThan(0);
      expect(r.aliquota).toBeLessThan(1);
    }
  });

  it('MEI → {tipo:mei, valorFixo>0}', () => {
    const r = montarPreview({ regimeCode: '4', anexo: null, receitas: [], competencia: '202606' });
    expect(r.tipo).toBe('mei');
    if (r.tipo === 'mei') expect(r.valorFixo).toBeGreaterThan(0);
  });

  it('Regime Normal (3) → indisponivel', () => {
    const r = montarPreview({ regimeCode: '3', anexo: null, receitas: [], competencia: '202606' });
    expect(r).toEqual({ tipo: 'indisponivel' });
  });

  it('Simples sem anexo → indisponivel', () => {
    const r = montarPreview({ regimeCode: '1', anexo: null, receitas: [], competencia: '202606' });
    expect(r).toEqual({ tipo: 'indisponivel' });
  });
});
