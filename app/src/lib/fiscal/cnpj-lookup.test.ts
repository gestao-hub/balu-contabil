// Testes da consulta de CNPJ compartilhada. Mocka globalThis.fetch e reimporta
// o módulo após setar FOCUS_NFE_TOKEN (mesmo padrão de focus-nfe.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PREV_TOKEN = process.env.FOCUS_NFE_TOKEN;

let lookupCnpj: typeof import('./cnpj-lookup')['lookupCnpj'];

beforeEach(async () => {
  process.env.FOCUS_NFE_TOKEN = 'test-token-123';
  vi.resetModules();
  ({ lookupCnpj } = await import('./cnpj-lookup'));
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

describe('lookupCnpj — mapeamento', () => {
  it('mapeia campos da Focus (incl. IE/IM e apelidos) e normaliza CEP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        razao_social: 'Acme Ltda',
        nome_fantasia: 'Acme',
        inscricao_estadual: '123456789',
        inscricao_municipal: '987654',
        logradouro: 'Rua A',
        numero: '100',
        complemento: 'Sala 2',
        bairro: 'Centro',
        municipio: 'Curitiba',
        uf: 'PR',
        cep: '80210-000',
        telefone: '4133221100',
        email: 'contato@acme.com',
      }),
    );

    const r = await lookupCnpj('12345678000123');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      razao_social: 'Acme Ltda',
      nome_fantasia: 'Acme',
      inscricao_estadual: '123456789',
      inscricao_municipal: '987654',
      logradouro: 'Rua A',
      numero: '100',
      complemento: 'Sala 2',
      bairro: 'Centro',
      municipio: 'Curitiba',
      uf: 'PR',
      cep: '80210000',
      telefone: '4133221100',
      email: 'contato@acme.com',
    });
  });

  it('lê endereço aninhado em `endereco` (shape REAL da Focus /v2/cnpjs)', async () => {
    // Resposta real capturada em produção: endereço fica sob `endereco` e o
    // município é `nome_municipio` (não `municipio`).
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        razao_social: 'MAGAZINE LUIZA S/A',
        cnpj: '47960950000121',
        situacao_cadastral: 'ativa',
        cnae_principal: '4713004',
        endereco: {
          codigo_municipio: '6425',
          codigo_ibge: '3516200',
          nome_municipio: 'Franca',
          logradouro: 'VOLUNTARIOS DA FRANCA',
          complemento: '',
          numero: '1465',
          bairro: 'CENTRO',
          cep: '14400490',
          uf: 'SP',
        },
      }),
    );

    const r = await lookupCnpj('47960950000121');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.razao_social).toBe('MAGAZINE LUIZA S/A');
    expect(r.data.logradouro).toBe('VOLUNTARIOS DA FRANCA');
    expect(r.data.numero).toBe('1465');
    expect(r.data.bairro).toBe('CENTRO');
    expect(r.data.municipio).toBe('Franca');
    expect(r.data.uf).toBe('SP');
    expect(r.data.cep).toBe('14400490');
    // complemento vazio → undefined (não vira string vazia)
    expect(r.data.complemento).toBeUndefined();
  });

  it('usa apelidos `nome` e `fantasia` quando os canônicos faltam', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, { nome: 'Beta SA', fantasia: 'Beta' }),
    );

    const r = await lookupCnpj('12345678000123');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.razao_social).toBe('Beta SA');
    expect(r.data.nome_fantasia).toBe('Beta');
  });

  it('expõe optante_mei/optante_simples_nacional/cnae_principal (shape real)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, {
        razao_social: 'AL PISCINAS LTDA',
        cnae_principal: '4299501',
        optante_simples_nacional: true,
        optante_mei: false,
        endereco: { nome_municipio: 'Londrina', uf: 'PR' },
      }),
    );
    const r = await lookupCnpj('10358425000120');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.optante_simples_nacional).toBe(true);
    expect(r.data.optante_mei).toBe(false);
    expect(r.data.cnae_principal).toBe('4299501');
  });

  it('optante ausente → undefined (não vira false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse(200, { razao_social: 'Sem Flags SA' }),
    );
    const r = await lookupCnpj('10358425000120');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.optante_mei).toBeUndefined();
    expect(r.data.optante_simples_nacional).toBeUndefined();
    expect(r.data.cnae_principal).toBeUndefined();
  });
});

describe('lookupCnpj — erros', () => {
  it('CNPJ inválido (≠14 dígitos) não chama a Focus', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await lookupCnpj('123');
    expect(r).toEqual({ ok: false, error: 'CNPJ inválido.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('CNPJ só com zeros é inválido', async () => {
    const r = await lookupCnpj('00000000000000');
    expect(r).toEqual({ ok: false, error: 'CNPJ inválido.' });
  });

  it('404 da Focus → "não encontrado"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'CNPJ não encontrado na Receita.' });
  });

  it('5xx repetido da Focus → "indisponível"', async () => {
    // call() faz 3 tentativas em 5xx; mockamos 503 em todas.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 503, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'Serviço de consulta indisponível. Tente novamente.' });
  });

  it('erro de rede → "indisponível"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const r = await lookupCnpj('12345678000123');
    expect(r).toEqual({ ok: false, error: 'Serviço de consulta indisponível. Tente novamente.' });
  });
});
