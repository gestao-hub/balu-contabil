// 0094 — credenciais do SERPRO cifradas em repouso, e o par completo.
//
// Mesma razão do `config-focus.test.ts` para pinar o formato de fio: os valores
// foram migrados do `.env.local` por um script que reimplementou a cifra.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';

const CHAVE_B64 = Buffer.alloc(32, 7).toString('base64');
const ENV_ANTES = { ...process.env };

let mod: typeof import('./config-serpro');

beforeEach(async () => {
  process.env.CERT_ENC_KEY = CHAVE_B64;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SERPRO_CONSUMER_KEY;
  delete process.env.SERPRO_CONSUMER_SECRET;
  vi.resetModules();
  mod = await import('./config-serpro');
});

afterEach(() => {
  process.env = { ...ENV_ANTES };
});

describe('cifra da credencial', () => {
  it('guarda cifrado e lê de volta o mesmo valor', () => {
    const cifrado = mod.guardarSegredoSerpro('consumer-secret-xyz');
    expect(cifrado).toMatch(/^enc:v1:/);
    expect(cifrado).not.toContain('consumer-secret-xyz');
    expect(mod.lerSegredoSerpro(cifrado)).toBe('consumer-secret-xyz');
  });

  it('recusa guardar vazio', () => {
    expect(() => mod.guardarSegredoSerpro('')).toThrow(/vazio/);
  });

  it('recusa LER valor sem cifra', () => {
    expect(() => mod.lerSegredoSerpro('em-claro')).toThrow(/corrompida/);
  });

  it('lê o formato produzido fora do app (script de migração)', () => {
    const chave = Buffer.from(CHAVE_B64, 'base64');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', chave, iv);
    const ct = Buffer.concat([c.update('vindo-de-fora', 'utf8'), c.final()]);
    const externo = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');

    expect(mod.lerSegredoSerpro(externo)).toBe('vindo-de-fora');
  });

  it('mascara sem revelar o miolo', () => {
    expect(mod.mascararSegredoSerpro('abcdefghijklmnop')).toBe('abcd…mnop');
    expect(mod.mascararSegredoSerpro(null)).toBe('…');
  });
});

describe('fallback de ambiente', () => {
  it('sem credencial devolve null', async () => {
    expect(await mod.obterCredenciaisSerpro()).toBeNull();
  });

  it('MEIA credencial é tratada como nenhuma', async () => {
    // Devolver `{ key, secret: undefined }` faria o Basic sair como
    // `chave:undefined` e a Receita responder 401 — erro que apontaria para o
    // SERPRO em vez de apontar para a configuração pela metade.
    process.env.SERPRO_CONSUMER_KEY = 'só-a-key';
    mod.invalidarCacheSerpro();

    expect(await mod.obterCredenciaisSerpro()).toBeNull();
  });

  it('par completo no ambiente é aceito', async () => {
    process.env.SERPRO_CONSUMER_KEY = 'k';
    process.env.SERPRO_CONSUMER_SECRET = 's';
    mod.invalidarCacheSerpro();

    expect(await mod.obterCredenciaisSerpro()).toEqual({ consumerKey: 'k', consumerSecret: 's' });
  });
});
