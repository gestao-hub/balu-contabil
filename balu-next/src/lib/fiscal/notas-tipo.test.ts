import { describe, it, expect } from 'vitest';
import { assertTipoDoc, validarJustificativa } from './notas-tipo';

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
