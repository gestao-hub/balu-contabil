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
});
