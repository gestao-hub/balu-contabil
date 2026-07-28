// Bloco 4B — testes do cliente Asaas: garantem que `asaasSub` sempre manda o
// header `access_token` do TOKEN DA SUBCONTA, e que a conta-mãe (`asaas` e
// `asaasContaMae`) sempre manda a chave da Balu lida do ambiente.
//
// Existem porque `, token` é fácil demais de apagar num método de `asaasSub`
// sem quebrar tsc nem os outros testes — e o efeito é a cobrança do
// escritório nascer na conta da Balu, em silêncio. Ver asaas.ts:47-55.
//
// Espelha o padrão de focus-nfe.test.ts: fetch mockado, headers inspecionados.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PREV_SANDBOX = process.env.TOKEN_ASAAS_SANDBOX;
const PREV_ENV = process.env.ASAAS_ENV;

let asaas: typeof import('./asaas')['asaas'];
let asaasSub: typeof import('./asaas')['asaasSub'];
let asaasContaMae: typeof import('./asaas')['asaasContaMae'];

const CONTA_MAE_KEY = 'conta-mae-key-999';
const SUB_TOKEN = 'subconta-token-abc';

beforeEach(async () => {
  process.env.TOKEN_ASAAS_SANDBOX = CONTA_MAE_KEY;
  delete process.env.ASAAS_ENV; // ausente => sandbox (ver asaas.ts:14)
  vi.resetModules();
  // Reimporta após setar env pra garantir que apiKey() leia o valor de teste.
  ({ asaas, asaasSub, asaasContaMae } = await import('./asaas'));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREV_SANDBOX === undefined) delete process.env.TOKEN_ASAAS_SANDBOX;
  else process.env.TOKEN_ASAAS_SANDBOX = PREV_SANDBOX;
  if (PREV_ENV === undefined) delete process.env.ASAAS_ENV;
  else process.env.ASAAS_ENV = PREV_ENV;
});

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Extrai o header access_token da primeira chamada do fetch mockado. */
function accessTokenUsado(fetchSpy: { mock: { calls: unknown[][] } }): string {
  const [, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
  const headers = init?.headers as Record<string, string>;
  return headers.access_token;
}

describe('asaasSub — access_token deve ser o token da SUBCONTA', () => {
  it('criarCliente', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 'cus_1', name: 'Escritorio X', cpfCnpj: '12345678900' }));

    await asaasSub(SUB_TOKEN).criarCliente({ name: 'Escritorio X', cpfCnpj: '12345678900' });

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
  });

  it('criarCobranca', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 'pay_1', value: 100, dueDate: '2026-08-10', status: 'PENDING' }));

    await asaasSub(SUB_TOKEN).criarCobranca({
      customer: 'cus_1', billingType: 'PIX', value: 100, dueDate: '2026-08-10',
    });

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
  });

  it('consultarCobranca', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 'pay_1', value: 100, dueDate: '2026-08-10', status: 'PENDING' }));

    await asaasSub(SUB_TOKEN).consultarCobranca('pay_1');

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
  });

  it('listarCobrancas', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { data: [] }));

    await asaasSub(SUB_TOKEN).listarCobrancas();

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
  });

  it('pixDaCobranca', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { payload: 'copia-e-cola', encodedImage: 'base64img' }));

    await asaasSub(SUB_TOKEN).pixDaCobranca('pay_1');

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
  });

  // O mais perigoso da lista: `/v3/myAccount/status` responde 200 para
  // QUALQUER token válido. Com a chave da conta-mãe ele devolve o KYC da Balu,
  // que está aprovado — e toda subconta seria marcada 'aprovada' sem que nada
  // quebrasse.
  it('consultarStatusConta', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 'acc_1', commercialInfo: 'APPROVED', bankAccountInfo: 'APPROVED',
        documentation: 'APPROVED', general: 'APPROVED',
      }),
    );

    await asaasSub(SUB_TOKEN).consultarStatusConta();

    expect(accessTokenUsado(fetchSpy)).toBe(SUB_TOKEN);
    const [url] = fetchSpy.mock.calls[0]! as [string, unknown];
    expect(url).toContain('/v3/myAccount/status');
  });
});

describe('asaas (conta-mãe) — access_token deve ser a chave da Balu, nunca da subconta', () => {
  it('criarCliente usa a chave da conta-mãe lida do ambiente', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 'cus_2', name: 'Cliente Balu', cpfCnpj: '98765432100' }));

    await asaas.criarCliente({ name: 'Cliente Balu', cpfCnpj: '98765432100' });

    const token = accessTokenUsado(fetchSpy);
    expect(token).toBe(CONTA_MAE_KEY);
    expect(token).not.toBe(SUB_TOKEN);
  });
});

describe('asaasContaMae — criação e listagem de subconta vão pela conta-mãe', () => {
  it('criarSubconta usa a chave da conta-mãe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 'acc_1', walletId: 'wallet_1', apiKey: 'chave-gerada-pelo-asaas',
        name: 'Escritorio X', email: 'x@escritorio.com', cpfCnpj: '11222333000144',
      }),
    );

    await asaasContaMae.criarSubconta({ name: 'Escritorio X', cpfCnpj: '11222333000144' });

    expect(accessTokenUsado(fetchSpy)).toBe(CONTA_MAE_KEY);
  });

  it('listarSubcontas usa a chave da conta-mãe', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, { totalCount: 0, data: [] }));

    await asaasContaMae.listarSubcontas();

    expect(accessTokenUsado(fetchSpy)).toBe(CONTA_MAE_KEY);
  });
});

// A subconta so mostra a `apiKey` na resposta da criacao. Se o Asaas cria a
// conta e o gateway devolve 504, o retry ou cria uma SEGUNDA subconta ou bate
// em documento duplicado — nos dois casos a primeira ficou com a chave
// perdida. `POST /v3/accounts` e a unica chamada nao idempotente cuja resposta
// carrega um segredo de uma vez so: ela nao pode repetir.
describe('retry — criarSubconta nao repete, o resto do 4A repete', () => {
  it('criarSubconta faz UMA tentativa em 504 e propaga o status anexado', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('gateway timeout', { status: 504 }));

    await expect(
      asaasContaMae.criarSubconta({ name: 'Escritorio X', cpfCnpj: '11222333000144' }),
    ).rejects.toMatchObject({ status: 504 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('criarSubconta tambem nao repete em conexao cortada', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('read ECONNRESET'));

    await expect(
      asaasContaMae.criarSubconta({ name: 'Escritorio X', cpfCnpj: '11222333000144' }),
    ).rejects.toThrow(/ECONNRESET/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // REGRESSAO DO 4A: o retry das cobrancas da propria Balu tem de continuar
  // exatamente como estava. Perder isto e a Balu deixar de cobrar em silencio.
  it('as demais chamadas continuam repetindo 3x em 502', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('bad gateway', { status: 502 }));

    await expect(asaas.criarCliente({ name: 'Cliente Balu', cpfCnpj: '98765432100' }))
      .rejects.toThrow(/502/);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 10_000);

  // O status anexado ao erro e o que deixa a action distinguir "o Asaas
  // recusou o dado" (nada foi criado) de "nao sei se nasceu".
  it('erro de resposta carrega o status HTTP no proprio erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"errors":[{"code":"invalid_cpfCnpj"}]}', { status: 400 }),
    );

    await expect(
      asaasContaMae.criarSubconta({ name: 'Escritorio X', cpfCnpj: '1' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('asaasSub — guarda contra token ausente', () => {
  it("asaasSub('') lança antes de qualquer fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(() => asaasSub('')).toThrow(/token da subconta ausente/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
