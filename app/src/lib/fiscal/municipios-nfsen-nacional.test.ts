import { describe, it, expect } from 'vitest';
import { isAderenteNfsenNacional } from './municipios-nfsen-nacional';

describe('isAderenteNfsenNacional', () => {
  it('Londrina (4113700) → true em 2026', () => {
    expect(isAderenteNfsenNacional('4113700', new Date('2026-05-28'))).toBe(true);
  });
  it('Londrina (4113700) → false antes da data de obrigatoriedade', () => {
    expect(isAderenteNfsenNacional('4113700', new Date('2025-12-31'))).toBe(false);
  });
  it('null/empty → false', () => {
    expect(isAderenteNfsenNacional(null)).toBe(false);
    expect(isAderenteNfsenNacional('')).toBe(false);
    expect(isAderenteNfsenNacional(undefined)).toBe(false);
  });
  it('código fora da lista → false', () => {
    expect(isAderenteNfsenNacional('9999999')).toBe(false);
  });
});
