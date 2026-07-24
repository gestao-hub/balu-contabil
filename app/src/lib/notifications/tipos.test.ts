import { describe, it, expect } from 'vitest';
import { NOTIFICACAO_TIPOS, severidadePadrao, TIPOS_VALIDOS } from './tipos';

describe('notificacao tipos', () => {
  it('inclui abertura_etapa (usado pelo Bloco 2)', () => {
    expect(TIPOS_VALIDOS).toContain('abertura_etapa');
  });
  it('das_vencido é danger', () => {
    expect(severidadePadrao('das_vencido')).toBe('danger');
  });
  it('das_a_vencer é warning', () => {
    expect(severidadePadrao('das_a_vencer')).toBe('warning');
  });
  it('todo tipo tem label', () => {
    for (const t of TIPOS_VALIDOS) {
      expect(NOTIFICACAO_TIPOS[t].label.length).toBeGreaterThan(0);
    }
  });
});
