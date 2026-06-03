import { describe, it, expect } from 'vitest';
import { parseApoiarToken } from './serpro';

describe('parseApoiarToken', () => {
  it('extrai de dados.autenticar_procurador_token (corpo 200)', () => {
    const body = JSON.stringify({ dados: JSON.stringify({ autenticar_procurador_token: 'tok-123' }) });
    expect(parseApoiarToken(body, undefined)).toBe('tok-123');
  });

  it('extrai de autenticarProcuradorToken no topo do JSON', () => {
    const body = JSON.stringify({ autenticarProcuradorToken: 'tok-abc' });
    expect(parseApoiarToken(body, undefined)).toBe('tok-abc');
  });

  it('cai pro ETag quando o corpo não traz token (304)', () => {
    const etag = '"autenticar_procurador_token:tok-etag"';
    expect(parseApoiarToken('', etag)).toBe('tok-etag');
  });

  it('retorna null quando não há token', () => {
    expect(parseApoiarToken('{}', undefined)).toBeNull();
  });
});
