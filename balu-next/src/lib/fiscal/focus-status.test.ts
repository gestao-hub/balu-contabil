import { describe, it, expect } from 'vitest';
import { mapStatusFocus } from './focus-status';

describe('mapStatusFocus', () => {
  it('autorizado → ativa', () => {
    expect(mapStatusFocus('autorizado')).toBe('ativa');
    expect(mapStatusFocus('Autorizado')).toBe('ativa');
    expect(mapStatusFocus('AUTORIZADA')).toBe('ativa');
  });
  it('cancelado → cancelada', () => {
    expect(mapStatusFocus('cancelado')).toBe('cancelada');
    expect(mapStatusFocus('Cancelada')).toBe('cancelada');
  });
  it('inutilizado → cancelada', () => {
    expect(mapStatusFocus('inutilizado')).toBe('cancelada');
  });
  it('denegado/rejeitado/erro → erro', () => {
    expect(mapStatusFocus('denegado')).toBe('erro');
    expect(mapStatusFocus('rejeitado')).toBe('erro');
    expect(mapStatusFocus('erro_autorizacao')).toBe('erro');
  });
  it('processando_autorizacao → pendente', () => {
    expect(mapStatusFocus('processando_autorizacao')).toBe('pendente');
    expect(mapStatusFocus('em_processamento')).toBe('pendente');
  });
  it('null/undefined/vazio → pendente', () => {
    expect(mapStatusFocus(null)).toBe('pendente');
    expect(mapStatusFocus(undefined)).toBe('pendente');
    expect(mapStatusFocus('')).toBe('pendente');
  });
  it('desconhecido → pendente (default seguro)', () => {
    expect(mapStatusFocus('foo_bar')).toBe('pendente');
  });
});
