import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PAGE1 = [
  {
    codigo_municipio: '4113700', nome_municipio: 'Londrina', sigla_uf: 'PR',
    nome_uf: 'Paraná', nfse_habilitada: true, status_nfse: 'ativo',
    provedor_nfse: 'Nacional', requer_certificado_nfse: true,
    possui_ambiente_homologacao_nfse: true, possui_cancelamento_nfse: true,
    cpf_cnpj_obrigatorio_nfse: null, endereco_obrigatorio_nfse: null,
    item_lista_servico_obrigatorio_nfse: null, codigo_cnae_obrigatorio_nfse: null,
    codigo_tributario_municipio_obrigatorio_nfse: null, ultima_emissao_nfse: null,
  },
];
const PAGE2 = [
  {
    codigo_municipio: '3550308', nome_municipio: 'São Paulo', sigla_uf: 'SP',
    nome_uf: 'São Paulo', nfse_habilitada: true, status_nfse: 'ativo',
    provedor_nfse: 'Betha2', requer_certificado_nfse: true,
    possui_ambiente_homologacao_nfse: false, possui_cancelamento_nfse: true,
    cpf_cnpj_obrigatorio_nfse: null, endereco_obrigatorio_nfse: null,
    item_lista_servico_obrigatorio_nfse: null, codigo_cnae_obrigatorio_nfse: null,
    codigo_tributario_municipio_obrigatorio_nfse: null, ultima_emissao_nfse: null,
  },
];

function makeFetchResponse(body: unknown, totalCount: number) {
  return {
    ok: true,
    headers: { get: (h: string) => h === 'x-total-count' ? String(totalCount) : null },
    json: async () => body,
  };
}

describe('fetchAllMunicipiosFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.FOCUS_NFE_TOKEN = 'test-token';
  });

  it('retorna todos os itens concatenando páginas', async () => {
    // total=101 > PAGE_SIZE=100, triggering a second page fetch (offset=100)
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(PAGE1, 101))
      .mockResolvedValueOnce(makeFetchResponse(PAGE2, 101));

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    const result = await fetchAllMunicipiosFocus();

    expect(result).toHaveLength(2);
    expect(result[0].codigo_municipio).toBe('4113700');
    expect(result[1].codigo_municipio).toBe('3550308');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('offset=0'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('offset=100'), expect.any(Object));
  });

  it('retorna array vazio se total=0', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([], 0));

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    const result = await fetchAllMunicipiosFocus();

    expect(result).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('lança erro se resposta HTTP não for ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    await expect(fetchAllMunicipiosFocus()).rejects.toThrow('Focus /v2/municipios → 401');
  });
});
