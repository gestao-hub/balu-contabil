import { describe, it, expect, vi, afterEach } from 'vitest';
import { enviarMensagem } from './cliente';

afterEach(() => vi.restoreAllMocks());

describe('cliente uazapi', () => {
  it('manda o texto para a instancia configurada, com o token no header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: true, status: 200, json: async () => ({}) } as Response);

    await enviarMensagem(
      { baseUrl: 'https://minha-instancia.uazapi.com', token: 'TOKEN_TESTE' },
      { telefone: '+5511999998888', texto: 'oi' });

    expect(String(spy.mock.calls[0][0])).toContain('minha-instancia.uazapi.com');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).token).toBe('TOKEN_TESTE');
  });

  it('sem instancia/token configurados, no-op sem lancar', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await enviarMensagem(null, { telefone: '+5511999998888', texto: 'oi' });
    expect(r).toEqual({ ok: false, skipped: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('erro do provedor nao lanca — devolve ok:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const r = await enviarMensagem(
      { baseUrl: 'https://x.uazapi.com', token: 't' },
      { telefone: '+5511999998888', texto: 'oi' });
    expect(r.ok).toBe(false);
  });
});
