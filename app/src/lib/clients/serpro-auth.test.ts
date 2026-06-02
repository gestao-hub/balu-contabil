import { describe, it, expect } from 'vitest';
import { parseAuthResponse } from './serpro-auth';

describe('parseAuthResponse', () => {
  it('mapeia jwt_token/access_token/expires_in', () => {
    const t = parseAuthResponse({ jwt_token: 'JWT', access_token: 'AT', expires_in: 3600 });
    expect(t.jwt).toBe('JWT');
    expect(t.accessToken).toBe('AT');
    expect(new Date(t.expiration).getTime()).toBeGreaterThan(Date.now());
  });

  it('usa TTL default de 3600s quando expires_in ausente', () => {
    const t = parseAuthResponse({ jwt_token: 'J', access_token: 'A' });
    const deltaMs = new Date(t.expiration).getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(3_500_000);
    expect(deltaMs).toBeLessThan(3_700_000);
  });

  it('lança quando faltam tokens', () => {
    expect(() => parseAuthResponse({ foo: 'bar' })).toThrow();
  });
});
