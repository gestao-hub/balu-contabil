// Relatório de Situação Fiscal → Storage + `relatorios_situacao_fiscal` (0111)
// + aviso quando aparece pendência.
//
// AVISO SÓ NA VIRADA. Pendência que já estava no relatório anterior não gera
// aviso de novo a cada semana: o aviso sai quando o resultado PASSA a ser
// 'com_pendencias' (o anterior era outro, ou não havia anterior).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadToBucket } from '@/lib/clients/supabase-storage';
import { emitirRelatorioSitfis } from '@/lib/fiscal/serpro-sitfis';
import { analisarRelatorio, type ResultadoSitfis } from '@/lib/fiscal/sitfis-parse';

export const BUCKET_RELATORIOS = 'relatorios-fiscais';

export type ResultadoGerarSitfis =
  | { ok: true; id: string; resultado: ResultadoSitfis }
  | { ok: false; error: string; aindaGerando?: boolean };

export async function gerarRelatorioSitfisEmpresa(
  admin: SupabaseClient, companyId: string,
  opts: { solicitadoPor: string | null; esperaMaximaMs: number },
): Promise<ResultadoGerarSitfis> {
  const r = await emitirRelatorioSitfis(admin, companyId, { esperaMaximaMs: opts.esperaMaximaMs });
  // "Ainda gerando" é tentativa INTERROMPIDA, não consulta feita: carimbar
  // aqui escondia a empresa da varredura por INTERVALO_DIAS (achado do
  // code-review de 06/10). Erro definitivo (sem autorização, sem CNPJ)
  // carimba, senão a empresa ocupa a frente da fila todo dia.
  if (r.ok || !r.aindaGerando) await carimbar(admin, companyId);
  if (!r.ok) return r;

  const resultado = analisarRelatorio(r.pdf);
  const agora = new Date();
  const path = `${companyId}/sitfis-${agora.toISOString().replace(/[:.]/g, '-')}.pdf`;
  try {
    await uploadToBucket(BUCKET_RELATORIOS, path, r.pdf, 'application/pdf');
  } catch (e) {
    console.error('[sitfis] upload do relatório falhou', companyId, e instanceof Error ? e.message : e);
    return { ok: false, error: 'O relatório foi emitido, mas não pôde ser guardado. Tente de novo.' };
  }

  const { data: anterior } = await admin.from('relatorios_situacao_fiscal')
    .select('resultado').eq('company_id', companyId)
    .order('emitido_em', { ascending: false }).limit(1).maybeSingle();

  const { data: linha, error } = await admin.from('relatorios_situacao_fiscal').insert({
    company_id: companyId, emitido_em: agora.toISOString(), storage_path: path,
    resultado, solicitado_por: opts.solicitadoPor,
  }).select('id').single();
  if (error || !linha) {
    console.error('[sitfis] gravação do relatório falhou', companyId, error?.message);
    return { ok: false, error: 'O relatório foi emitido, mas não pôde ser registrado. Tente de novo.' };
  }

  if (resultado === 'com_pendencias' && anterior?.resultado !== 'com_pendencias') {
    await avisarPendencia(admin, companyId, linha.id as string);
  }
  return { ok: true, id: linha.id as string, resultado };
}

async function avisarPendencia(admin: SupabaseClient, companyId: string, relatorioId: string): Promise<void> {
  const { data: empresa } = await admin.from('companies')
    .select('user_id, contabilidade_id, nome, razao_social').eq('id', companyId).maybeSingle();
  const nome = ((empresa?.nome as string | null)?.trim() || (empresa?.razao_social as string | null)?.trim()) ?? '';
  const destinos: { userId: string; href: string }[] = [];
  if (empresa?.user_id) destinos.push({ userId: empresa.user_id as string, href: '/receita/mensagens' });
  if (empresa?.contabilidade_id) {
    const { data: membros } = await admin.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', empresa.contabilidade_id as string);
    for (const m of membros ?? []) destinos.push({ userId: m.user_id as string, href: `/contador/clientes/${companyId}/receita` });
  }
  if (destinos.length === 0) return;
  const { error } = await admin.from('notifications').upsert(destinos.map((d) => ({
    owner_user_id: d.userId, company_id: companyId, tipo: 'situacao_fiscal_pendencia', severidade: 'danger',
    titulo: 'Pendência na situação fiscal da Receita',
    corpo: `${nome ? `${nome}: ` : ''}o relatório de situação fiscal aponta pendência (débito ou declaração). Isso impede a certidão negativa.`,
    entidade_ref: relatorioId, action_href: d.href,
    chave: `sitfis_pendencia:${relatorioId}`,
  })), { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
  if (error) console.error('[sitfis] aviso de pendência falhou:', error.message);
}

async function carimbar(admin: SupabaseClient, companyId: string): Promise<void> {
  const { error } = await admin.from('empresas_fiscais')
    .update({ sitfis_consultado_em: new Date().toISOString() }).eq('empresa_id', companyId);
  if (error) console.error('[sitfis] carimbo falhou', companyId, error.message);
}

// ─── VARREDURA ───────────────────────────────────────────────────────────────

/** Semanal: a situação fiscal não muda todo dia, e cada relatório custa duas
 *  chamadas ao SERPRO mais a espera da geração. */
const INTERVALO_DIAS = 7;
const CUSTO_EMPRESA_MS = 8_000;
/** Margem para a emissão em si (2ª chamada, upload, gravação) depois da espera. */
const MARGEM_APOS_ESPERA_MS = 3_000;
const TETO_EMPRESAS = 5_000;

export type ResultadoVarreduraSitfis = {
  elegiveis: number; emitidos: number; com_pendencias: number; erros: number; cortada_por_orcamento: boolean;
};

export async function rodarSitfis(
  admin: SupabaseClient, opts: { orcamentoMs: number; agora?: Date },
): Promise<ResultadoVarreduraSitfis> {
  const inicio = Date.now();
  const agora = opts.agora ?? new Date();
  const r: ResultadoVarreduraSitfis = { elegiveis: 0, emitidos: 0, com_pendencias: 0, erros: 0, cortada_por_orcamento: false };

  const { data: certs, error: eC } = await admin.from('arquivos_auxiliares')
    .select('company_id').not('storage_key', 'is', null).is('deleted_at', null).limit(TETO_EMPRESAS);
  if (eC) { r.erros++; return r; }
  const comCert = new Set((certs ?? []).map((c) => c.company_id as string));

  const { data: fiscais, error: eF } = await admin.from('empresas_fiscais')
    .select('empresa_id, sitfis_consultado_em').is('deleted_at', null).limit(TETO_EMPRESAS);
  if (eF) { r.erros++; return r; }

  const limite = agora.getTime() - INTERVALO_DIAS * 86_400_000;
  const fila = (fiscais ?? [])
    .filter((f) => comCert.has(f.empresa_id as string))
    .filter((f) => !f.sitfis_consultado_em || new Date(f.sitfis_consultado_em as string).getTime() < limite)
    .sort((a, b) => String(a.sitfis_consultado_em ?? '').localeCompare(String(b.sitfis_consultado_em ?? '')));
  r.elegiveis = fila.length;

  for (const f of fila) {
    if (Date.now() - inicio + CUSTO_EMPRESA_MS > opts.orcamentoMs) { r.cortada_por_orcamento = true; break; }
    // A espera usa o orçamento que SOBRA, não um teto fixo: com 6s fixos
    // (achado do code-review de 06/10), uma Receita que leva 10s para gerar
    // deixava TODA empresa em "ainda gerando" — e a varredura nunca produzia
    // relatório. Empresa que ainda assim não couber volta amanhã (sem carimbo).
    const restante = opts.orcamentoMs - (Date.now() - inicio) - MARGEM_APOS_ESPERA_MS;
    const res = await gerarRelatorioSitfisEmpresa(admin, f.empresa_id as string, {
      solicitadoPor: null, esperaMaximaMs: Math.max(0, restante),
    });
    if (!res.ok) { r.erros++; console.warn(`[sitfis] ${f.empresa_id}: ${res.error}`); continue; }
    r.emitidos++;
    if (res.resultado === 'com_pendencias') r.com_pendencias++;
  }
  return r;
}
