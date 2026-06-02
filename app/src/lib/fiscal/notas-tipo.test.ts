import { describe, it, expect } from 'vitest';
import { assertTipoDoc, validarJustificativa, cancelamentoSoPortal } from './notas-tipo';

describe('assertTipoDoc', () => {
  it('aceita NFe/NFCe/NFSe', () => {
    expect(assertTipoDoc('NFe')).toBe('NFe');
    expect(assertTipoDoc('NFCe')).toBe('NFCe');
    expect(assertTipoDoc('NFSe')).toBe('NFSe');
  });
  it('lança para tipo inválido', () => {
    expect(() => assertTipoDoc('NFX')).toThrow();
    expect(() => assertTipoDoc('')).toThrow();
  });
});

describe('validarJustificativa', () => {
  it('rejeita menos de 15 caracteres (após trim)', () => {
    expect(validarJustificativa('curta').ok).toBe(false);
    expect(validarJustificativa('   '.padEnd(20)).ok).toBe(false); // só espaços
  });
  it('aceita 15+ caracteres', () => {
    expect(validarJustificativa('cancelamento por erro de digitação').ok).toBe(true);
  });
});

describe('cancelamentoSoPortal', () => {
  it('bloqueia NFSe em município só-portal', () => {
    expect(cancelamentoSoPortal('NFSe', true)).toBe(true);
  });
  it('libera NFSe quando o município permite cancelar por API', () => {
    expect(cancelamentoSoPortal('NFSe', false)).toBe(false);
    expect(cancelamentoSoPortal('NFSe', null)).toBe(false);
    expect(cancelamentoSoPortal('NFSe', undefined)).toBe(false);
  });
  it('não se aplica a NFe/NFCe (cancelam via SEFAZ, não dependem do portal municipal)', () => {
    expect(cancelamentoSoPortal('NFe', true)).toBe(false);
    expect(cancelamentoSoPortal('NFCe', true)).toBe(false);
  });
});
