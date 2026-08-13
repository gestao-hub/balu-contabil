import { describe, it, expect } from 'vitest';
import { validarSalarioMinimo, lerValorBR, estaEmDia } from './salario-minimo-entrada';

const HOJE = new Date('2026-08-12T12:00:00Z');
const ok = (v: number, data = '2026-01-01') =>
  validarSalarioMinimo({ valor: v, vigenciaInicio: data }, HOJE);

describe('lerValorBR', () => {
  it('aceita o formato que o admin lê', () => {
    expect(lerValorBR('1.621,00')).toBe(1621);
    expect(lerValorBR('1621,50')).toBe(1621.5);
    expect(lerValorBR('1621.50')).toBe(1621.5);
    expect(lerValorBR('1621')).toBe(1621);
    expect(lerValorBR('R$ 1.621,00')).toBe(1621);
  });

  it('vazio vira NaN, não zero', () => {
    // Zero passaria por "número" e viraria INSS de R$ 0,00.
    expect(Number.isNaN(lerValorBR(''))).toBe(true);
    expect(Number.isNaN(lerValorBR('   '))).toBe(true);
  });
});

describe('validarSalarioMinimo', () => {
  it('aceita um valor plausível', () => {
    const r = ok(1621);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados).toEqual({ valor: 1621, vigenciaInicio: '2026-01-01', norma: null });
  });

  it('recusa um dígito a mais — o erro que ninguém percebe', () => {
    // R$ 16.210 passaria por qualquer "número positivo" e multiplicaria por
    // dez o INSS de toda a base.
    expect(ok(16210).ok).toBe(false);
  });

  it('recusa um dígito a menos', () => {
    expect(ok(162).ok).toBe(false);
  });

  it('recusa zero e negativo', () => {
    expect(ok(0).ok).toBe(false);
    expect(ok(-1621).ok).toBe(false);
  });

  it('recusa mais de dois decimais', () => {
    expect(ok(1621.005).ok).toBe(false);
  });

  it('recusa data malformada e data que não existe', () => {
    expect(validarSalarioMinimo({ valor: 1621, vigenciaInicio: '2026' }, HOJE).ok).toBe(false);
    expect(validarSalarioMinimo({ valor: 1621, vigenciaInicio: '2026-02-31' }, HOJE).ok).toBe(false);
  });

  it('aceita agendar para o ano que vem', () => {
    // O caminho normal: cadastrar em dezembro o valor que entra em janeiro.
    expect(ok(1700, '2027-01-01').ok).toBe(true);
  });

  it('recusa agendar longe demais e vigência antiga demais', () => {
    // Ano digitado errado ficaria invisível por uma década.
    expect(ok(1700, '2035-01-01').ok).toBe(false);
    expect(ok(1000, '2015-01-01').ok).toBe(false);
  });

  it('norma em branco vira null, não string vazia', () => {
    const r = validarSalarioMinimo(
      { valor: 1621, vigenciaInicio: '2026-01-01', norma: '   ' }, HOJE,
    );
    expect(r.ok && r.dados.norma).toBeNull();
  });
});

describe('estaEmDia', () => {
  it('é por ano civil, não por dias desde a última atualização', () => {
    // 20 de dezembro com o valor de janeiro: em dia.
    expect(estaEmDia('2026-01-01', new Date('2026-12-20T12:00:00Z'))).toBe(true);
    // 3 de janeiro com o valor do ano passado: velho, mesmo com poucos dias.
    expect(estaEmDia('2026-01-01', new Date('2027-01-03T12:00:00Z'))).toBe(false);
  });

  it('sem nenhuma vigência, não está em dia', () => {
    expect(estaEmDia(null, HOJE)).toBe(false);
    expect(estaEmDia(undefined, HOJE)).toBe(false);
  });
});
