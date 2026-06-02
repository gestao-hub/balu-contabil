import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://api.focusnfe.com.br';
const PAGE_SIZE = 100;

type FocusMunicipio = {
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function authHeader(token: string): string {
  return 'Basic ' + btoa(`${token}:`);
}

async function fetchPage(token: string, offset: number): Promise<{ items: FocusMunicipio[]; total: number }> {
  const res = await fetch(`${BASE}/v2/municipios?offset=${offset}`, {
    headers: { Authorization: authHeader(token) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Focus /v2/municipios → ${res.status}: ${body}`);
  }
  const total = Number(res.headers.get('x-total-count') ?? 0);
  const items = await res.json() as FocusMunicipio[];
  return { items, total };
}

async function fetchAll(token: string): Promise<FocusMunicipio[]> {
  const { items: first, total } = await fetchPage(token, 0);
  if (total <= PAGE_SIZE) return first;

  const pages: FocusMunicipio[][] = [first];
  const extraCalls = Math.ceil((total - PAGE_SIZE) / PAGE_SIZE);

  await Promise.all(
    Array.from({ length: extraCalls }, (_, i) =>
      fetchPage(token, (i + 1) * PAGE_SIZE).then(({ items }) => { pages[i + 1] = items; }),
    ),
  );

  return pages.flat();
}

Deno.serve(async (_req) => {
  // Auth delegada ao Supabase: a função é deployada COM verificação de JWT (padrão).
  // O agendador passa Authorization: Bearer <service_role_key> — visível em
  // Project Settings → API, sem precisar copiar nenhum secret extra.
  // Para chamadas manuais (curl/test), use o mesmo service_role_key.

  const focusToken = Deno.env.get('FOCUS_API_TOKEN');
  if (!focusToken) {
    return new Response(JSON.stringify({ error: 'FOCUS_API_TOKEN não configurado' }), { status: 500 });
  }

  const start = Date.now();

  const municipios = await fetchAll(focusToken);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date().toISOString();
  const rows = municipios.map((m) => ({
    codigo_ibge: m.codigo_municipio,
    nome_municipio: m.nome_municipio,
    uf: m.sigla_uf,
    nome_uf: m.nome_uf,
    nfse_habilitada: m.nfse_habilitada,
    status_nfse: m.status_nfse,
    provedor_nfse: m.provedor_nfse ?? null,
    requer_certificado_nfse: m.requer_certificado_nfse ?? null,
    possui_ambiente_homologacao_nfse: m.possui_ambiente_homologacao_nfse ?? null,
    possui_cancelamento_nfse: m.possui_cancelamento_nfse ?? null,
    cpf_cnpj_obrigatorio_nfse: m.cpf_cnpj_obrigatorio_nfse ?? null,
    endereco_obrigatorio_nfse: m.endereco_obrigatorio_nfse ?? null,
    item_lista_servico_obrigatorio_nfse: m.item_lista_servico_obrigatorio_nfse ?? null,
    codigo_cnae_obrigatorio_nfse: m.codigo_cnae_obrigatorio_nfse ?? null,
    codigo_tributario_municipio_obrigatorio_nfse: m.codigo_tributario_municipio_obrigatorio_nfse ?? null,
    ultima_emissao_nfse: m.ultima_emissao_nfse ?? null,
    focus_synced_at: now,
    updated_at: now,
  }));

  let upserted = 0;
  let failed = 0;

  for (const chunk of chunkArray(rows, 500)) {
    const { error } = await supabase
      .from('municipios_nfse')
      .upsert(chunk, { onConflict: 'codigo_ibge' });
    if (error) {
      console.error('[sync-municipios] chunk error:', error.message);
      failed += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  const duration_ms = Date.now() - start;

  if (failed > 0) {
    return new Response(
      JSON.stringify({ ok: false, total: municipios.length, upserted, failed, duration_ms }),
      { status: 207, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, total: municipios.length, upserted, duration_ms }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
