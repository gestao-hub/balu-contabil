import { describe, it, expect } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('aceita paths internos legítimos', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/convite/abc123')).toBe('/convite/abc123');
    expect(safeNext('/contador?tab=notas')).toBe('/contador?tab=notas');
  });

  it('rejeita open-redirect por barra dupla e esquema', () => {
    expect(safeNext('//evil.com')).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
    expect(safeNext('http://evil.com')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
  });

  it('rejeita bypass por backslash (browser resolve \\ como /)', () => {
    expect(safeNext('/\\evil.com')).toBeNull();
    expect(safeNext('/\\/evil.com')).toBeNull();
  });

  it('rejeita bypass por TAB/CR/LF (WHATWG URL remove antes de parsear)', () => {
    expect(safeNext('/\t/evil.com')).toBeNull();
    expect(safeNext('/\n/evil.com')).toBeNull();
    expect(safeNext('/\r/evil.com')).toBeNull();
    // sanity: o vetor realmente resolve pra fora se não bloqueado
    expect(new URL('/\t/evil.com', 'https://good.example').host).toBe('evil.com');
  });

  it('não começando com / é rejeitado', () => {
    expect(safeNext('evil.com')).toBeNull();
    expect(safeNext('')).toBeNull();
  });
});
