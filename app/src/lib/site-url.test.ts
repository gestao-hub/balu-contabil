import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSiteUrl } from './site-url';

const PREV = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  SITE_URL: process.env.SITE_URL,
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.SITE_URL;
});

afterEach(() => {
  vi.unstubAllEnvs(); // restaura NODE_ENV stubado
  // SITE_URL e NEXT_PUBLIC_SITE_URL não são read-only — restaura à mão.
  if (PREV.NEXT_PUBLIC_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = PREV.NEXT_PUBLIC_SITE_URL;
  if (PREV.SITE_URL === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = PREV.SITE_URL;
});

describe('getSiteUrl', () => {
  it('prefere NEXT_PUBLIC_SITE_URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://balu.app';
    expect(getSiteUrl()).toBe('https://balu.app');
  });

  it('cai pra SITE_URL quando NEXT_PUBLIC_SITE_URL ausente', () => {
    process.env.SITE_URL = 'https://staging.balu.app';
    expect(getSiteUrl()).toBe('https://staging.balu.app');
  });

  it('remove barra(s) final(is)', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://balu.app///';
    expect(getSiteUrl()).toBe('https://balu.app');
  });

  it('aceita http://localhost:porta', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });

  it('rejeita URL inválida (com path)', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://balu.app/path';
    expect(() => getSiteUrl()).toThrow(/inválido/);
  });

  it('rejeita URL sem protocolo', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'balu.app';
    expect(() => getSiteUrl()).toThrow(/inválido/);
  });

  it('em dev sem env → fallback localhost:3000', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });

  it('em prod sem env → lança Error claro', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getSiteUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});
