import { describe, it, expect } from 'vitest';
import {
  componentesDasMei, valorDasMei, inssMensal, SALARIO_MINIMO_FALLBACK,
} from './das-mei';

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

describe('composição do DAS-MEI', () => {
  it('Comércio ou Indústria = INSS + ICMS', () => {
    const c = componentesDasMei('Comercio ou Industria');
    expect(Object.keys(c)).toEqual(['inss', 'icms']);
    expect(c.inss).toBeCloseTo(75.90, 2);
    expect(c.icms).toBeCloseTo(1.00, 2);
  });

  it('Prestação de Serviços = INSS + ISS', () => {
    const c = componentesDasMei('Prestacao de Servicos');
    expect(Object.keys(c)).toEqual(['inss', 'iss']);
    expect(c.iss).toBeCloseTo(5.00, 2);
  });

  it('Comércio e Serviços = INSS + ICMS + ISS', () => {
    expect(Object.keys(componentesDasMei('Comercio e Servicos')))
      .toEqual(['inss', 'icms', 'iss']);
  });

  // A INVARIANTE QUE JUSTIFICA A REFATORAÇÃO: total e partes não podem divergir.
  // Antes, o total era digitado à mão ao lado das partes em comentário.
  it.each([
    'Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos',
  ] as const)('o total de %s é exatamente a soma dos componentes', (a) => {
    const soma = Object.values(componentesDasMei(a)).reduce((s, v) => s + v, 0);
    expect(valorDasMei(a)).toBeCloseTo(soma, 2);
  });

  // Atividade desconhecida cai em Serviços — comportamento ATUAL, preservado de
  // propósito: mudar isso alteraria a estimativa de quem não preencheu a atividade.
  it('atividade desconhecida ou nula cai em Prestação de Serviços', () => {
    expect(valorDasMei(null)).toBeCloseTo(valorDasMei('Prestacao de Servicos'), 2);
    expect(valorDasMei('bananas')).toBeCloseTo(valorDasMei('Prestacao de Servicos'), 2);
  });
});

describe('salário mínimo como parâmetro (0079)', () => {
  it('INSS é 5% do mínimo, arredondado em centavos', () => {
    expect(inssMensal(1518)).toBe(75.90);
    expect(inssMensal(1621)).toBe(81.05);
  });

  it('sem mínimo informado usa o fallback de 2025 — o valor de sempre', () => {
    // Garante que versionar não mudou nenhum número em produção enquanto a
    // linha de 2026 não existir em parametros_fiscais.
    expect(inssMensal()).toBe(75.90);
    expect(SALARIO_MINIMO_FALLBACK).toBe(1518);
    expect(valorDasMei('Prestacao de Servicos')).toBe(80.90);
  });

  it('mínimo inválido não vira NaN nem zero: cai no fallback', () => {
    // Uma linha torta em parametros_fiscais não pode gerar guia de R$ 0,00 —
    // seria um DAS impossível de pagar e um imposto omitido.
    for (const ruim of [0, -1, NaN, Infinity]) {
      expect(inssMensal(ruim)).toBe(75.90);
    }
  });

  it('o mínimo atravessa até o total, componente a componente', () => {
    const c = componentesDasMei('Comercio e Servicos', 1600);
    expect(c.inss).toBe(80);
    expect(c.icms).toBe(1);
    expect(c.iss).toBe(5);
    expect(valorDasMei('Comercio e Servicos', 1600)).toBe(86);
  });
});
