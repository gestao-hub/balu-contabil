// Bloco 5 — o download le o ambiente DA NOTA (`nota.ambiente`), nunca 'hom'
// fixo. Uma nota emitida em producao tem PDF/XML na base de producao da
// Focus; ler pela base de homologacao devolve 404 (ou o arquivo errado, se
// por acaso existir um `ref` colidente).
//
// M7 (a mordida deste arquivo): trocar `const ENV = (nota.ambiente ?? 'hom')`
// por `const ENV = 'hom'` fixo passa pelo typecheck e nao muda a assinatura
// da rota — so muda QUAL base a Focus consulta.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase (sessao), o gate de aceites,
// `tokenParaAmbiente` e o cliente Focus (fallback legacy). `fetch` global e
// stubado pra capturar a URL pedida quando a nota tem `pdf_url`/`xml_url`
// relativo (caminho da NFSe Nacional) — e exatamente aí que `focusBase(ENV)`
// entra na URL. `assertTipoDoc`/`urlDownloadPermitida` NAO sao mockados —
// sao puros, testados em outro arquivo, e usá-los de verdade evita
// reimplementar a regra deles dentro do mock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    user: { id: 'user-1' } as { id: string } | null,
    companyId: 'empresa-1' as string | null,
    nota: null as Record<string, unknown> | null,
    aceites: { ok: true } as { ok: true } | { ok: false; error: string },
    tokenPorAmbiente: { hom: 'tok-hom', prod: 'tok-prod' } as Record<string, string | null>,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        eq: () => chain,
        maybeSingle: async () => {
          if (tabela === 'notas_fiscais') return { data: estado.nota, error: null };
          return { data: null, error: null };
        },
        single: async () => {
          if (tabela === 'profiles') {
            return { data: estado.companyId ? { current_company: estado.companyId } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }));

  const getUser = vi.fn(async () => ({ data: { user: estado.user } }));
  const supabase = { from, auth: { getUser } };
  const createServerClient = vi.fn(async () => supabase);

  const assertAceitesEmDia = vi.fn(async () => estado.aceites);
  const tokenParaAmbiente = vi.fn(
    async (_companyId: string, ambiente: 'hom' | 'prod') => estado.tokenPorAmbiente[ambiente] ?? null,
  );

  const focus = {
    baixarDanfe: vi.fn(async () => ({ contentType: 'application/pdf', body: new ArrayBuffer(0) })),
    baixarXmlNfe: vi.fn(async () => ({ contentType: 'application/xml', body: '<xml/>' })),
    baixarDanfeNfce: vi.fn(async () => ({ contentType: 'application/pdf', body: new ArrayBuffer(0) })),
    baixarXmlNfce: vi.fn(async () => ({ contentType: 'application/xml', body: '<xml/>' })),
  };

  return { estado, from, createServerClient, assertAceitesEmDia, tokenParaAmbiente, focus };
});

vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }));
vi.mock('@/lib/lgpd/pendencia-aceite', () => ({ assertAceitesEmDia: h.assertAceitesEmDia }));
vi.mock('@/lib/fiscal/resolver-credencial', () => ({ tokenParaAmbiente: h.tokenParaAmbiente }));
vi.mock('@/lib/clients/focus-nfe', () => ({ focus: h.focus }));

import { GET } from './route';

const req = (formato: string) => new Request(`https://x/notas_fiscais/nota-1/download?formato=${formato}`);
const params = () => Promise.resolve({ id: 'nota-1' });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.estado.user = { id: 'user-1' };
  h.estado.companyId = 'empresa-1';
  h.estado.nota = null;
  h.estado.aceites = { ok: true };
  h.estado.tokenPorAmbiente = { hom: 'tok-hom', prod: 'tok-prod' };
  h.createServerClient.mockClear();
  h.assertAceitesEmDia.mockClear();
  h.tokenParaAmbiente.mockClear();
  for (const fn of Object.values(h.focus)) fn.mockClear();

  fetchMock = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '<xml/>',
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /notas_fiscais/[id]/download — le o ambiente da NOTA (M7)', () => {
  it('nota de producao busca o PDF (path relativo) na base de PRODUCAO', async () => {
    h.estado.nota = {
      tipo_documento: 'NFSe',
      referencia: 'ref-1',
      pdf_url: '/v2/nfsen/ref-1.pdf',
      xml_url: null,
      ambiente: 'prod',
    };
    const res = await GET(req('pdf'), { params: params() });
    expect(res.status).toBe(200);
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'prod');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const urlChamada = fetchMock.mock.calls[0]![0] as string;
    expect(urlChamada.startsWith('https://api.focusnfe.com.br')).toBe(true);
  });

  it('nota de homologacao busca o PDF na base de HOMOLOGACAO', async () => {
    h.estado.nota = {
      tipo_documento: 'NFSe',
      referencia: 'ref-2',
      pdf_url: '/v2/nfsen/ref-2.pdf',
      xml_url: null,
      ambiente: 'hom',
    };
    const res = await GET(req('pdf'), { params: params() });
    expect(res.status).toBe(200);
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'hom');
    const urlChamada = fetchMock.mock.calls[0]![0] as string;
    expect(urlChamada.startsWith('https://homologacao.focusnfe.com.br')).toBe(true);
  });

  it('nota de producao SEM token de producao cadastrado recusa (409), nao cai pra hom', async () => {
    h.estado.nota = {
      tipo_documento: 'NFSe',
      referencia: 'ref-3',
      pdf_url: '/v2/nfsen/ref-3.pdf',
      xml_url: null,
      ambiente: 'prod',
    };
    h.estado.tokenPorAmbiente = { hom: 'tok-hom', prod: null };
    const res = await GET(req('pdf'), { params: params() });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('XML de nota de producao tambem busca na base de PRODUCAO', async () => {
    h.estado.nota = {
      tipo_documento: 'NFSe',
      referencia: 'ref-4',
      pdf_url: null,
      xml_url: '/v2/nfsen/ref-4.xml',
      ambiente: 'prod',
    };
    const res = await GET(req('xml'), { params: params() });
    expect(res.status).toBe(200);
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'prod');
    const urlChamada = fetchMock.mock.calls[0]![0] as string;
    expect(urlChamada.startsWith('https://api.focusnfe.com.br')).toBe(true);
  });
});
