import { describe, it, expect, afterEach } from 'vitest';
import { resolveSerproEnv, demoInputs } from './serpro-env';

const original = process.env.SERPRO_ENV;
afterEach(() => { process.env.SERPRO_ENV = original; });

describe('resolveSerproEnv', () => {
  it('default é trial quando não setado', () => {
    delete process.env.SERPRO_ENV;
    expect(resolveSerproEnv()).toBe('trial');
  });
  it('respeita prod', () => {
    process.env.SERPRO_ENV = 'prod';
    expect(resolveSerproEnv()).toBe('prod');
  });
  it('valor inválido cai em trial', () => {
    process.env.SERPRO_ENV = 'xpto';
    expect(resolveSerproEnv()).toBe('trial');
  });
});

describe('demoInputs', () => {
  it('CNPJ e período de demonstração do Serpro', () => {
    expect(demoInputs()).toEqual({ cnpj: '00000000000100', periodo: '201901' });
  });
});
