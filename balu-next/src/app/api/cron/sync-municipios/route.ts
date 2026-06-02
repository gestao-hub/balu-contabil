import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAllMunicipiosFocus } from '@/lib/clients/focus-municipios';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const start = Date.now();

  const municipios = await fetchAllMunicipiosFocus();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
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
    return NextResponse.json({ ok: false, total: municipios.length, upserted, failed, duration_ms }, { status: 207 });
  }

  return NextResponse.json({ ok: true, total: municipios.length, upserted, duration_ms });
}
