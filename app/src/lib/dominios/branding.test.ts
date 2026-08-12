import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    cabecalhos: {} as Record<string, string>,
    resposta: { data: [] as unknown[], error: null as { message: string } | null },
  };
  const rpc = vi.fn(async () => estado.resposta);
  return { estado, rpc };
});

vi.mock('next/headers', () => ({ headers: async () => new Headers(h.estado.cabecalhos) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ rpc: h.rpc }) }));
vi.mock('@/lib/clients/supabase-storage', () => ({
  signedUrlBranding: async (p: string) => `https://signed/${p}`,
}));

import { brandingDoHost } from './branding';

beforeEach(() => {
  h.estado.cabecalhos = {};
  h.estado.resposta = { data: [], error: null };
  h.rpc.mockClear();
});

describe('brandingDoHost', () => {
  it('consulta com o host normalizado do x-forwarded-host', async () => {
    h.estado.cabecalhos = { 'x-forwarded-host': 'APP.Escritorio.com.br:443', host: 'balu-abc.vercel.app' };
    h.estado.resposta = {
      data: [{ contabilidade_id: 'c1', nome: 'Escritório X', logo_url: 'c1/logo.png', sla_resposta_horas: 24 }],
      error: null,
    };

    const r = await brandingDoHost();

    expect(h.rpc).toHaveBeenCalledWith('branding_por_host', { p_host: 'app.escritorio.com.br' });
    expect(r).toEqual({
      contabilidadeId: 'c1', nome: 'Escritório X',
      logoUrl: 'https://signed/c1/logo.png', slaRespostaHoras: 24,
    });
  });

  it('host sem escritório dono => null (cai na marca Balu)', async () => {
    h.estado.cabecalhos = { host: 'app.desconhecido.com.br' };
    await expect(brandingDoHost()).resolves.toBeNull();
  });

  it('erro na RPC => null, sem derrubar a página', async () => {
    // Marca é enfeite: um blip de rede não pode quebrar a tela de login.
    h.estado.cabecalhos = { host: 'app.escritorio.com.br' };
    h.estado.resposta = { data: [], error: { message: 'timeout' } };
    await expect(brandingDoHost()).resolves.toBeNull();
  });

  it('sem cabeçalho de host nenhum => null e nem consulta o banco', async () => {
    await expect(brandingDoHost()).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('escritório sem logo => devolve nome com logoUrl null', async () => {
    h.estado.cabecalhos = { host: 'app.escritorio.com.br' };
    h.estado.resposta = {
      data: [{ contabilidade_id: 'c1', nome: 'Escritório X', logo_url: null, sla_resposta_horas: null }],
      error: null,
    };
    await expect(brandingDoHost()).resolves.toMatchObject({ nome: 'Escritório X', logoUrl: null, slaRespostaHoras: null });
  });

  it('hosts diferentes consultam chaves diferentes (sem cache compartilhado)', async () => {
    // Landmine 6.2 da spec: uma entrada de cache sem o host na chave serviria
    // a marca de um escritório no domínio de outro.
    h.estado.cabecalhos = { host: 'app.a.com.br' };
    h.estado.resposta = { data: [{ contabilidade_id: 'a', nome: 'A', logo_url: null, sla_resposta_horas: null }], error: null };
    await expect(brandingDoHost()).resolves.toMatchObject({ nome: 'A' });

    h.estado.cabecalhos = { host: 'app.b.com.br' };
    h.estado.resposta = { data: [{ contabilidade_id: 'b', nome: 'B', logo_url: null, sla_resposta_horas: null }], error: null };
    await expect(brandingDoHost()).resolves.toMatchObject({ nome: 'B' });

    expect(h.rpc.mock.calls.map((c) => (c as unknown as [string, { p_host: string }])[1].p_host))
      .toEqual(['app.a.com.br', 'app.b.com.br']);
  });
});
