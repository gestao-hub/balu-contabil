import { describe, it, expect } from 'vitest';
import { isNadaDevido } from './serpro-das-comum';

describe('isNadaDevido', () => {
  it('dados vazio → true', () => {
    expect(isNadaDevido({ dados: '' })).toBe(true);
    expect(isNadaDevido({ dados: null })).toBe(true);
    expect(isNadaDevido({})).toBe(true);
  });

  it('mensagem MSG_E0139 → true', () => {
    expect(isNadaDevido({ dados: 'qualquer', mensagens: [{ codigo: '[Aviso-PGDASD-MSG_E0139]', texto: '...' }] })).toBe(true);
  });

  it('dados populado sem MSG_E0139 → false', () => {
    expect(isNadaDevido({ dados: '{"x":1}', mensagens: [] })).toBe(false);
    expect(isNadaDevido({ dados: '[{"a":1}]' })).toBe(false);
  });
});
