import { describe, it, expect } from 'vitest';
import { calcularApuracao, RegimeNaoSuportadoError, ConfiguracaoIncompletaError } from './apuracao';
import type { ReceitaApuracao } from './apuracao-types';

const mk = (comp: string, valor: number): ReceitaApuracao => ({ competencia: comp, valor });

describe('calcularApuracao', () => {
  it('MEI: valor fixo, rbt12/alíquota null, receita do mês somada', () => {
    const r = calcularApuracao({
      regimeCode: '4', anexo: null, competencia: '202506',
      receitas: [mk('202506', 5000)], atividadeMei: 'Prestacao de Servicos',
      // Competência de 2025 → o mínimo daquele ano, passado como quem lê
      // `parametros_fiscais` passaria. Prova de que o parâmetro atravessa até
      // o valor da guia, e não só até `das-mei.ts`.
      salarioMinimo: 1518,
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

describe('calcularApuracao — segregação por anexo', () => {
  // rbt12 = 120000 (faixa 1 em todos os anexos): uma receita no mês anterior.
  const prior = { competencia: '202605', valor: 120000 };

  it('atividade única (sem anexo por nota) = comportamento de hoje', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [prior, { competencia: '202606', valor: 10000 }],
    });
    expect(r.tipoApuracao).toBe('Simples Nacional');
    expect(r.valorImposto).toBeCloseTo(400, 2); // 10000 * 4% (Anexo I faixa 1)
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(false);
  });

  it('dois anexos: soma as fatias com alíquotas distintas', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [
        prior,
        { competencia: '202606', valor: 10000, anexo: 'Anexo I' },   // 4% → 400
        { competencia: '202606', valor: 5000, anexo: 'Anexo III' },  // 6% → 300
      ],
    });
    expect(r.valorImposto).toBeCloseTo(700, 2);
    const bd = r.breakdown as { segregado: boolean; porAnexo: Array<{ anexo: string; valor: number }> };
    expect(bd.segregado).toBe(true);
    expect(bd.porAnexo).toHaveLength(2);
    expect(bd.porAnexo.find((p) => p.anexo === 'Anexo III')!.valor).toBeCloseTo(300, 2);
  });

  it('nota sem anexo usa o fallback; mistura com nota anexada', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [
        prior,
        { competencia: '202606', valor: 10000 },                     // fallback Anexo I → 400
        { competencia: '202606', valor: 5000, anexo: 'Anexo III' },  // 6% → 300
      ],
    });
    expect(r.valorImposto).toBeCloseTo(700, 2);
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(true);
  });

  it('receita zero no mês → imposto zero', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [prior],
    });
    expect(r.valorImposto).toBe(0);
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(false);
  });
});

// helper local do teste: volta `n` meses de uma competência YYYYMM
function competenciaBack(comp: string, n: number): string {
  const y = Number(comp.slice(0, 4));
  const m = Number(comp.slice(4, 6));
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, '0')}`;
}

describe('calcularApuracao — falta configuracao (bug de producao, 19/08/2026)', () => {
  // A `ideapp` falhava TODO DIA no cron: Simples sem `anexo_simples` e com o
  // CNAE no catalogo `cnae_anexo` com `anexo_base` NULL. Lancava Error generico,
  // o cron contava como "erro" e retentava no dia seguinte -- e retentar nao
  // cria configuracao que ninguem preencheu.
  it('Simples sem anexo lanca ConfiguracaoIncompletaError, nao Error generico', () => {
    let capturado: unknown;
    try {
      calcularApuracao({ regimeCode: '1', anexo: null, competencia: '202607', receitas: [] });
    } catch (e) { capturado = e; }

    expect(capturado).toBeInstanceOf(ConfiguracaoIncompletaError);
    // O campo que falta viaja no erro: e o que permite ao chamador dizer ao
    // cliente O QUE preencher, em vez de "erro ao calcular".
    expect((capturado as ConfiguracaoIncompletaError).campo).toBe('anexo_simples');
  });

  it('NAO se confunde com regime nao suportado', () => {
    // Os dois sao "nao da para apurar", mas so um se resolve preenchendo algo.
    expect(() => calcularApuracao({ regimeCode: '3', anexo: null, competencia: '202607', receitas: [] }))
      .toThrow(RegimeNaoSuportadoError);
    expect(() => calcularApuracao({ regimeCode: '3', anexo: null, competencia: '202607', receitas: [] }))
      .not.toThrow(ConfiguracaoIncompletaError);
  });
});
