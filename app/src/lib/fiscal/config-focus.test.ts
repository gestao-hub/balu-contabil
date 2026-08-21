// 0094/0095/0099 — os tokens da Focus (hom/prod) para a conta da plataforma,
// cifrados em repouso, e o fallback de ambiente.
//
// O TESTE DO "FORMATO DE FIO" NÃO É ZELO: segredos deste projeto já foram
// gravados por scripts `.mjs` que REIMPLEMENTAM a cifra (o módulo é TypeScript
// e o projeto não tem runner .ts). Se o formato divergisse, a gravação
// pareceria boa no banco e o app não a leria — e o sintoma seria "Focus fora do
// ar", não "cifra errada".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';

// Chave fixa de teste (32 bytes). Nada aqui toca a chave real.
const CHAVE_B64 = Buffer.alloc(32, 7).toString('base64');

const ENV_ANTES = { ...process.env };

let mod: typeof import('./config-focus');

beforeEach(async () => {
  process.env.CERT_ENC_KEY = CHAVE_B64;
  // Sem Supabase configurado a leitura de banco é pulada e sobra o fallback de
  // ambiente — que é o que estes testes exercitam.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const k of ['FOCUS_NFE_TOKEN', 'FOCUS_NFE_TOKEN_PRODUCAO', 'FOCUS_NFE_HOMOLOGACAO']) {
    delete process.env[k];
  }
  vi.resetModules();
  mod = await import('./config-focus');
});

afterEach(() => {
  process.env = { ...ENV_ANTES };
});

describe('cifra do token', () => {
  it('guarda cifrado e lê de volta o mesmo valor', () => {
    const cifrado = mod.guardarTokenFocus('token-secreto-123');
    expect(cifrado).toMatch(/^enc:v1:/);
    expect(cifrado).not.toContain('token-secreto-123');
    expect(mod.lerTokenFocus(cifrado)).toBe('token-secreto-123');
  });

  it('recusa guardar vazio', () => {
    expect(() => mod.guardarTokenFocus('')).toThrow(/vazio/);
  });

  it('recusa LER valor sem cifra — gravação em claro é defeito, não legado', () => {
    // O `decifrarCampo` genérico devolveria o próprio valor aqui (fallback que
    // existe para certificado legado). Silenciar isso esconderia um token que
    // foi parar no banco em claro.
    expect(() => mod.lerTokenFocus('token-em-claro')).toThrow(/corrompida/);
  });

  it('lê o formato produzido fora do app (script de migração)', () => {
    // Réplica exata do que `cifrarCampo` produz:
    // 'enc:v1:' + base64( iv(12) ∥ authTag(16) ∥ ciphertext ).
    const chave = Buffer.from(CHAVE_B64, 'base64');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', chave, iv);
    const ct = Buffer.concat([c.update('vindo-de-fora', 'utf8'), c.final()]);
    const externo = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');

    expect(mod.lerTokenFocus(externo)).toBe('vindo-de-fora');
  });

  it('mascara sem revelar o miolo', () => {
    expect(mod.mascararTokenFocus('abcdefghijklmnop')).toBe('abcd…mnop');
    expect(mod.mascararTokenFocus('curto')).toBe('…');
    expect(mod.mascararTokenFocus(null)).toBe('…');
  });
});

describe('fallback por ambiente (0099)', () => {
  it('sem token em lugar nenhum devolve null para os dois ambientes', async () => {
    expect(await mod.obterTokenFocus('hom')).toBeNull();
    expect(await mod.obterTokenFocus('prod')).toBeNull();
  });

  it('usa FOCUS_NFE_HOMOLOGACAO para hom quando o banco está vazio', async () => {
    process.env.FOCUS_NFE_HOMOLOGACAO = 'token-de-homologacao';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenFocus('hom')).toBe('token-de-homologacao');
  });

  it('usa FOCUS_NFE_TOKEN_PRODUCAO para prod quando o banco está vazio', async () => {
    process.env.FOCUS_NFE_TOKEN_PRODUCAO = 'token-de-producao';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenFocus('prod')).toBe('token-de-producao');
  });

  it('usa FOCUS_NFE_TOKEN (genérico) para os dois ambientes quando falta o específico', async () => {
    // É o nome que existe nas variáveis de produção da Vercel — sem isto o
    // deploy desta mudança derrubaria a leitura que hoje funciona por ali.
    process.env.FOCUS_NFE_TOKEN = 'token-generico-vercel';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenFocus('hom')).toBe('token-generico-vercel');
    expect(await mod.obterTokenFocus('prod')).toBe('token-generico-vercel');
  });

  // A INVARIANTE QUE IMPORTA: o nome específico vence o genérico. Um token de
  // homologação usado contra a base de produção (ou o contrário) dá 401 — se
  // o genérico vencesse, o fallback recriaria esse defeito por conta própria.
  it('o nome específico do ambiente vence o FOCUS_NFE_TOKEN genérico', async () => {
    process.env.FOCUS_NFE_TOKEN = 'nao-deveria-ser-usado';
    process.env.FOCUS_NFE_HOMOLOGACAO = 'token-de-homologacao';
    process.env.FOCUS_NFE_TOKEN_PRODUCAO = 'token-de-producao';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenFocus('hom')).toBe('token-de-homologacao');
    expect(await mod.obterTokenFocus('prod')).toBe('token-de-producao');
  });

  it('cada ambiente só enxerga a variável do SEU nome — hom não usa FOCUS_NFE_TOKEN_PRODUCAO nem vice-versa', async () => {
    process.env.FOCUS_NFE_TOKEN_PRODUCAO = 'token-de-producao';
    mod.invalidarCacheFocus();

    // Sem FOCUS_NFE_HOMOLOGACAO nem FOCUS_NFE_TOKEN, 'hom' fica null — não
    // deveria "vazar" o token de produção.
    expect(await mod.obterTokenFocus('hom')).toBeNull();
    expect(await mod.obterTokenFocus('prod')).toBe('token-de-producao');
  });
});
