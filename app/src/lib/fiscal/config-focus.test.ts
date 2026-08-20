// 0094/0095 — o token de REVENDA da Focus cifrado em repouso, e o fallback.
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
  for (const k of [
    'FOCUS_NFE_TOKEN',
    'FOCUS_NFE_TOKEN_PRODUCAO',
    'FOCUS_NFE_TOKEN_PRODUÇÃO',
    'FOCUS_NFE_HOMOLOGACAO',
    'FOCUS_NFE_HOMOLOGAÇÃO',
  ]) delete process.env[k];
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

describe('fallback de ambiente', () => {
  it('sem token em lugar nenhum devolve null', async () => {
    expect(await mod.obterTokenRevendaFocus()).toBeNull();
  });

  it('usa FOCUS_NFE_TOKEN quando o banco está vazio', async () => {
    // É o caso da produção hoje. Sem este caminho, o deploy derrubaria o
    // cadastro de empresa, que funciona.
    process.env.FOCUS_NFE_TOKEN = 'token-de-revenda';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenRevendaFocus()).toBe('token-de-revenda');
  });

  // ESTE TESTE FIXA UM DEFEITO REAL, achado sondando a Focus em 20/08/2026.
  // `FOCUS_NFE_TOKEN_PRODUÇÃO` e `FOCUS_NFE_HOMOLOGAÇÃO` existem no `.env.local`
  // e passam em `/v2/codigos_cnae`, mas levam 401 em `/v2/empresas/:id` —
  // inclusive para um id qualquer. Não são tokens de revenda. Aceitá-los aqui
  // trocaria um erro claro ("não configurado") por um 401 no meio do cadastro
  // de empresa.
  it('NÃO aceita os tokens do .env.local que não têm acesso à revenda', async () => {
    process.env['FOCUS_NFE_TOKEN_PRODUÇÃO'] = 'nao-serve-para-revenda';
    process.env['FOCUS_NFE_HOMOLOGAÇÃO'] = 'nao-serve-para-revenda';
    process.env.FOCUS_NFE_TOKEN_PRODUCAO = 'nao-serve-para-revenda';
    process.env.FOCUS_NFE_HOMOLOGACAO = 'nao-serve-para-revenda';
    mod.invalidarCacheFocus();

    expect(await mod.obterTokenRevendaFocus()).toBeNull();
  });
});
