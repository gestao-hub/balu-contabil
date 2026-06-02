import 'server-only';

const BASE = 'https://api.focusnfe.com.br';
const PAGE_SIZE = 100;

export type FocusMunicipio = {
  codigo_municipio: string;
  nome_municipio: string;
  sigla_uf: string;
  nome_uf: string;
  nfse_habilitada: boolean;
  status_nfse: string;
  provedor_nfse?: string;
  requer_certificado_nfse?: boolean;
  possui_ambiente_homologacao_nfse?: boolean;
  possui_cancelamento_nfse?: boolean;
  cpf_cnpj_obrigatorio_nfse?: boolean | null;
  endereco_obrigatorio_nfse?: boolean | null;
  item_lista_servico_obrigatorio_nfse?: boolean | null;
  codigo_cnae_obrigatorio_nfse?: boolean | null;
  codigo_tributario_municipio_obrigatorio_nfse?: boolean | null;
  ultima_emissao_nfse?: string | null;
};

function authHeader(): string {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) throw new Error('FOCUS_NFE_TOKEN não configurado');
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64');
}

async function fetchPage(offset: number): Promise<{ items: FocusMunicipio[]; total: number }> {
  const url = `${BASE}/v2/municipios?offset=${offset}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Focus /v2/municipios → ${res.status}: ${body}`);
  }
  const total = Number(res.headers.get('x-total-count') ?? 0);
  const items = (await res.json()) as FocusMunicipio[];
  return { items, total };
}

/** Busca todos os municípios da Focus paginando até x-total-count. */
export async function fetchAllMunicipiosFocus(): Promise<FocusMunicipio[]> {
  const { items: first, total } = await fetchPage(0);
  if (total <= PAGE_SIZE) return first;

  const pages: FocusMunicipio[][] = [first];
  const remaining = total - PAGE_SIZE;
  const extraCalls = Math.ceil(remaining / PAGE_SIZE);

  await Promise.all(
    Array.from({ length: extraCalls }, (_, i) =>
      fetchPage((i + 1) * PAGE_SIZE).then(({ items }) => { pages[i + 1] = items; }),
    ),
  );

  return pages.flat();
}
