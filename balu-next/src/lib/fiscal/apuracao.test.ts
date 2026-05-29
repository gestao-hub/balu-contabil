import { describe, it, expect } from 'vitest';
import { calcularApuracao, RegimeNaoSuportadoError } from './apuracao';
import type { ReceitaApuracao } from './apuracao-types';

const mk = (comp: string, valor: number): ReceitaApuracao => ({ competencia: comp, valor });

describe('calcularApuracao', () => {
  it('MEI: valor fixo, rbt12/alíquota null, receita do mês somada', () => {
    const r = calcularApuracao({
      regimeCode: '4', anexo: null, competencia: '202506',
      receitas: [mk('202506', 5000)], atividadeMei: 'Prestacao de Servicos',
    });
    expect(r.tipoApuracao).toBe('DAS-MEI');
    expect(r.valorImposto).toBe(80.90);
    expect(r.rbt12).toBeNull();
    expect(r.receitaMes).toBe(5000);
  });

  it('Simples: receita do mês * alíquota efetiva (Bug 1 corrigido)', () => {
    // RBT12 = 200000 (12 meses anteriores), Anexo I faixa 2 → ~4,33%
    const anteriores = Array.from({ length: 12 }, (_, i) =>
      mk(competenciaBack('202506', i + 1), 200000 / 12),
    );
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202506',
      receitas: [...anteriores, mk('202506', 10000)],
    });
    expect(r.tipoApuracao).toBe('Simples Nacional');
    expect(r.rbt12).toBeCloseTo(200000, 0);
    expect(r.aliquotaEfetiva).toBeCloseTo(0.0433, 3);
    expect(r.receitaMes).toBe(10000);
    expect(r.valorImposto).toBeCloseTo(10000 * 0.0433, 0);
  });

  it('regime Normal (code 3) lança RegimeNaoSuportadoError', () => {
    expect(() =>
      calcularApuracao({ regimeCode: '3', anexo: null, competencia: '202506', receitas: [] }),
    ).toThrow(RegimeNaoSuportadoError);
  });

  it('receitas vazias: Simples → imposto 0', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo III', competencia: '202506', receitas: [],
    });
    expect(r.receitaMes).toBe(0);
    expect(r.valorImposto).toBe(0);
  });
});

// helper local do teste: volta `n` meses de uma competência YYYYMM
function competenciaBack(comp: string, n: number): string {
  const y = Number(comp.slice(0, 4));
  const m = Number(comp.slice(4, 6));
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, '0')}`;
}
