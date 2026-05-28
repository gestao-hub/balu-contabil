// @custom — Focus 1: testes do POST /v2/empresas com fetch mockado.
// Cobre happy path, 4xx (erro de negócio), 5xx (retry exponencial) e
// 503→200 (sucesso após retry).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PREV_TOKEN = process.env.FOCUS_NFE_TOKEN;

let focus: typeof import('./focus-nfe')['focus'];

beforeEach(async () => {
  process.env.FOCUS_NFE_TOKEN = 'test-token-123';
  vi.resetModules();
  // Reimporta após setar env pra garantir que auth() leia o valor de teste.
  ({ focus } = await import('./focus-nfe'));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (PREV_TOKEN === undefined) delete process.env.FOCUS_NFE_TOKEN;
  else process.env.FOCUS_NFE_TOKEN = PREV_TOKEN;
});

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PAYLOAD = {
  nome: 'Acme Ltda',
  cnpj: '12345678000123',
  regime_tributario: 1,
  municipio: 'Curitiba',
  uf: 'PR',
  logradouro: 'Rua A',
  numero: '100',
  bairro: 'Centro',
  cep: '80210000',
};

describe('focus.criarEmpresa', () => {
  it('happy path: POST 200 retorna token_homologacao + Basic auth correto', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse(200, {
        cnpj: '12345678000123',
        token_homologacao: 'TOKEN_HOM_XYZ',
      }));

    const resp = await focus.criarEmpresa(PAYLOAD, 'hom');

    expect(resp.token_homologacao).toBe('TOKEN_HOM_XYZ');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://homologacao.focusnfe.com.br/v2/empresas');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    // Basic = base64('test-token-123:') = 'dGVzdC10b2tlbi0xMjM6'
    expect(headers.Authorization).toBe('Basic dGVzdC10b2tlbi0xMjM6');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(PAYLOAD);
  });

  it('4xx: 422 com mensagem de erro lança Error com status + body (sem retry)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ codigo: 'cnpj_invalido', mensagem: 'CNPJ inválido' }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      );

    await expect(focus.criarEmpresa(PAYLOAD, 'hom')).rejects.toThrow(/422/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // sem retry em 4xx
  });

  it('503 persistente: retenta 3x e lança ao final', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } }),
      );

    await expect(focus.criarEmpresa(PAYLOAD, 'hom')).rejects.toThrow(/503/);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // MAX_RETRIES=3
  }, 10_000);

  it('503 → 200: sucesso após 1 retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(mockJsonResponse(200, { token_homologacao: 'OK_APOS_RETRY' }));

    const resp = await focus.criarEmpresa(PAYLOAD, 'hom');
    expect(resp.token_homologacao).toBe('OK_APOS_RETRY');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('env=hom usa homologacao; env=prod usa api', async () => {
    // Implementation gera um Response novo a cada chamada — não pode reusar instância
    // (Response.json() consome o body).
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => mockJsonResponse(200, { token_producao: 'P' }));

    await focus.criarEmpresa(PAYLOAD, 'prod');
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.focusnfe.com.br/v2/empresas');

    fetchSpy.mockClear();
    await focus.criarEmpresa(PAYLOAD, 'hom');
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://homologacao.focusnfe.com.br/v2/empresas');
  });

  it('FOCUS_NFE_TOKEN ausente → lança antes do fetch', async () => {
    delete process.env.FOCUS_NFE_TOKEN;
    vi.resetModules();
    const { focus: focusSemToken } = await import('./focus-nfe');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(focusSemToken.criarEmpresa(PAYLOAD, 'hom')).rejects.toThrow(/FOCUS_NFE_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
