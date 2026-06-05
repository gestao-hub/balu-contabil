import { describe, it, expect } from 'vitest';
import {
  tipoFromCode, isMei, faixaFromAnexo, anexoFromFaixa, fatorRAplicavel, normalizeRegimePatch,
  regimeFromOptante,
} from './regime';

describe('regime helpers', () => {
  it('tipoFromCode: 1-3 → simples, 4 → mei', () => {
    expect(tipoFromCode('1')).toBe('simples');
    expect(tipoFromCode('3')).toBe('simples');
    expect(tipoFromCode('4')).toBe('mei');
  });
  it('isMei só para code 4', () => {
    expect(isMei('4')).toBe(true);
    expect(isMei('1')).toBe(false);
    expect(isMei(null)).toBe(false);
  });
  it('faixa ↔ anexo', () => {
    expect(anexoFromFaixa('III Serviços comuns')).toBe('Anexo III');
    expect(faixaFromAnexo('Anexo III')).toBe('III Serviços comuns');
    expect(anexoFromFaixa('inexistente')).toBeNull();
  });
  it('fatorRAplicavel só em Anexo III/V', () => {
    expect(fatorRAplicavel('Anexo III')).toBe(true);
    expect(fatorRAplicavel('Anexo V')).toBe(true);
    expect(fatorRAplicavel('Anexo I')).toBe(false);
    expect(fatorRAplicavel(null)).toBe(false);
  });
  it('tipoFromCode aceita 2 e undefined', () => {
    expect(tipoFromCode('2')).toBe('simples');
    expect(tipoFromCode(undefined)).toBe('simples');
  });
  it('faixaFromAnexo/anexoFromFaixa lidam com null/undefined', () => {
    expect(faixaFromAnexo(null)).toBeNull();
    expect(anexoFromFaixa(undefined)).toBeNull();
  });
});

describe('normalizeRegimePatch', () => {
  it('sincroniza regime_tributario com o Code', () => {
    expect(normalizeRegimePatch({ Code_regime_tributario: '1' }).regime_tributario).toBe('simples');
    expect(normalizeRegimePatch({ Code_regime_tributario: '4' }).regime_tributario).toBe('mei');
  });
  it('MEI zera anexo e fator R', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '4', anexo_simples: 'Anexo III', usa_fator_r: true });
    expect(out.anexo_simples).toBeNull();
    expect(out.usa_fator_r).toBe(false);
  });
  it('Fator R forçado a false fora de Anexo III/V', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '1', anexo_simples: 'Anexo I', usa_fator_r: true });
    expect(out.usa_fator_r).toBe(false);
  });
  it('mantém Fator R em Anexo III', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '1', anexo_simples: 'Anexo III', usa_fator_r: true });
    expect(out.usa_fator_r).toBe(true);
  });
  it('patch parcial sem Code: força Fator R conforme anexo, não toca regime_tributario', () => {
    const out = normalizeRegimePatch({ anexo_simples: 'Anexo II', usa_fator_r: true });
    expect(out.usa_fator_r).toBe(false);
    expect(out.regime_tributario).toBeUndefined();
  });
  it('code vazio não sincroniza regime_tributario', () => {
    expect(normalizeRegimePatch({ Code_regime_tributario: '' }).regime_tributario).toBeUndefined();
  });
});

describe('normalizeRegimePatch — atividade_mei', () => {
  it('mantém atividade_mei quando MEI (code 4)', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '4', atividade_mei: 'Comercio ou Industria' });
    expect(out.atividade_mei).toBe('Comercio ou Industria');
  });

  it('zera atividade_mei quando não-MEI (code definido)', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '1', atividade_mei: 'Comercio ou Industria' });
    expect(out.atividade_mei).toBeNull();
  });

  it('não fabrica atividade_mei em patch sem Code', () => {
    const out = normalizeRegimePatch({ atividade_mei: 'Prestacao de Servicos' });
    expect(out.atividade_mei).toBe('Prestacao de Servicos');
  });
});

describe('regimeFromOptante', () => {
  it('optante_mei true → MEI (4)', () => {
    expect(regimeFromOptante(true, false)).toBe('4');
    expect(regimeFromOptante(true, true)).toBe('4'); // MEI tem precedência
  });
  it('optante_simples true (não MEI) → Simples (1)', () => {
    expect(regimeFromOptante(false, true)).toBe('1');
  });
  it('ambos explicitamente false → Regime Normal (3)', () => {
    expect(regimeFromOptante(false, false)).toBe('3');
  });
  it('desconhecido (null/undefined) → undefined (não infere)', () => {
    expect(regimeFromOptante(null, null)).toBeUndefined();
    expect(regimeFromOptante(undefined, undefined)).toBeUndefined();
    expect(regimeFromOptante(false, null)).toBeUndefined();
    expect(regimeFromOptante(null, true)).toBe('1'); // simples true ainda decide
  });
});
