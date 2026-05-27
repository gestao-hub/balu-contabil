import { describe, it, expect } from 'vitest';
import {
  tipoFromCode, isMei, faixaFromAnexo, anexoFromFaixa, fatorRAplicavel, normalizeRegimePatch,
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
});
