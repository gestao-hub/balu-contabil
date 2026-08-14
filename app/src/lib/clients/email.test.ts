import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail } from './email';

// O contrato que estes testes protegem: `sendEmail` NUNCA LANÇA. O laço de
// e-mail de `api/cron/obrigacoes` não tem try/catch — uma exceção aqui derruba
// o GET inteiro e a conciliação, a SERPRO, o billing e a apuração daquele dia
// não rodam. Foi assim até 14/08/2026.

const ORIGINAL = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_teste';
  process.env.EMAIL_FROM = 'Balu <nao-responda@baluhub.com.br>';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = ORIGINAL.key;
  process.env.EMAIL_FROM = ORIGINAL.from;
});

const carta = { to: 'cliente@exemplo.com', subject: 'DAS a vencer', html: '<p>oi</p>' };

describe('sendEmail — nunca lança', () => {
  it('sucesso: ok true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(sendEmail(carta)).resolves.toEqual({ ok: true });
  });

  it('rede caiu (fetch rejeita): devolve ok false em vez de propagar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const r = await sendEmail(carta);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ erro: expect.stringContaining('fetch failed') });
  });

  it('timeout (AbortError): devolve ok false em vez de propagar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    }));
    const r = await sendEmail(carta);
    expect(r.ok).toBe(false);
  });

  it('4xx/5xx da Resend: ok false, sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const r = await sendEmail(carta);
    expect(r).toEqual({ ok: false, erro: 'resend respondeu 429' });
  });

  it('corpo do erro ilegível não vira exceção', async () => {
    const res = new Response(null, { status: 500 });
    vi.spyOn(res, 'text').mockRejectedValue(new Error('corpo já consumido'));
    vi.stubGlobal('fetch', vi.fn(async () => res));
    await expect(sendEmail(carta)).resolves.toMatchObject({ ok: false });
  });

  it('sem credencial: skipped, e nem chega a chamar a rede', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await sendEmail(carta)).toEqual({ ok: false, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('sendEmail — teto de tempo por chamada', () => {
  it('manda um AbortSignal no fetch (sem ele, um socket pendurado come o cron inteiro)', async () => {
    // Aridade declarada de propósito: mock com zero parâmetros faz
    // `mock.calls[0][1]` não compilar — e é justamente o argumento que este
    // teste precisa ler. Mesma cicatriz de `cert-actions.test.ts`.
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await sendEmail(carta);
    const init = fetchSpy.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
