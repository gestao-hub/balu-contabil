// Bloco 5 — os tokens DA EMPRESA, cifrados em repouso.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CHAVE_B64 = Buffer.alloc(32, 7).toString('base64');
const ENV_ANTES = { ...process.env };
let mod: typeof import('./credencial-empresa');

beforeEach(async () => {
  process.env.CERT_ENC_KEY = CHAVE_B64;
  vi.resetModules();
  mod = await import('./credencial-empresa');
});
afterEach(() => { process.env = { ...ENV_ANTES }; });

describe('credencial da empresa', () => {
  it('guarda cifrado e le de volta', () => {
    const c = mod.guardarTokenEmpresa('tok-empresa-1');
    expect(c).toMatch(/^enc:v1:/);
    expect(c).not.toContain('tok-empresa-1');
    expect(mod.lerTokenEmpresa(c)).toBe('tok-empresa-1');
  });

  it('recusa guardar vazio', () => {
    expect(() => mod.guardarTokenEmpresa('')).toThrow(/vazio/);
  });

  it('recusa LER valor sem cifra — gravacao em claro e defeito', () => {
    expect(() => mod.lerTokenEmpresa('em-claro')).toThrow(/corrompida/);
  });

  it('null entra, null sai', () => {
    expect(mod.lerTokenEmpresa(null)).toBeNull();
  });
});
