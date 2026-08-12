import { describe, it, expect, vi } from 'vitest';
import { verificarHost } from './verificacao';
import { provedorDeEnv, provisionarDominio } from './provedor';

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

describe('verificarHost', () => {
  it('token igual => verificado', async () => {
    const f = vi.fn(async () => resposta({ token: 'tok-1' }));
    await expect(verificarHost('app.x.com.br', 'tok-1', f)).resolves.toEqual({ ok: true });
    expect(f.mock.calls[0][0]).toBe('https://app.x.com.br/api/dominio/verificacao');
  });

  it('token de OUTRO escritorio => recusa', async () => {
    // Acontece de verdade quando o host aponta pro dominio principal ou pro
    // dominio de outro escritorio: responde 200, com o registro errado.
    const f = vi.fn(async () => resposta({ token: 'tok-de-outro' }));
    const r = await verificarHost('app.x.com.br', 'tok-1', f);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ motivo: expect.stringContaining('outro escritório') });
  });

  it('DNS/TLS quebrado => frase de gente, nao stack trace', async () => {
    const f = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND app.x.com.br'); });
    const r = await verificarHost('app.x.com.br', 'tok-1', f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).not.toContain('ENOTFOUND');
      expect(r.motivo).toContain('DNS');
    }
  });

  it('host servindo outro site (404) => explica que o apontamento esta errado', async () => {
    const f = vi.fn(async () => new Response('nao encontrado', { status: 404 }));
    const r = await verificarHost('app.x.com.br', 'tok-1', f);
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining('404') });
  });

  it('resposta que nao e JSON => recusa sem explodir', async () => {
    const f = vi.fn(async () => new Response('<html>site alheio</html>', { status: 200 }));
    const r = await verificarHost('app.x.com.br', 'tok-1', f);
    expect(r.ok).toBe(false);
  });

  it('sem token gravado => manda salvar de novo, sem sair pra rede', async () => {
    const f = vi.fn(async () => resposta({ token: 'x' }));
    const r = await verificarHost('app.x.com.br', '', f);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('provedorDeEnv / provisionarDominio', () => {
  it('sem credencial da Vercel => modo manual (null)', () => {
    const prev = { t: process.env.VERCEL_API_TOKEN, p: process.env.VERCEL_PROJECT_ID };
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    expect(provedorDeEnv()).toBeNull();
    if (prev.t) process.env.VERCEL_API_TOKEN = prev.t;
    if (prev.p) process.env.VERCEL_PROJECT_ID = prev.p;
  });

  it('modo manual NAO e falha: provisionar devolve ok sem chamar rede', async () => {
    // O passo humano ("adicionar o dominio na Vercel") nao pode reprovar a
    // verificacao — quem decide se o dominio esta de pe e o HTTP.
    await expect(provisionarDominio(null, 'app.x.com.br')).resolves.toEqual({ ok: true, jaExistia: false });
  });
});
