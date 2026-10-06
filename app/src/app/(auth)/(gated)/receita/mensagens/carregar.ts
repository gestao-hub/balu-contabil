// Leitura da Caixa Postal para as duas telas (empresa e escritório). Pela
// SESSÃO: a RLS da 0110 (mensagens), da 0033 (empresas_fiscais, arquivos do
// escritório) e as do dono recortam o que cada um pode ver.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MensagemReceitaVm } from './CaixaPostalReceita';
import type { RelatorioSitfisVm } from './SituacaoFiscalCard';
import type { ParcelamentoVm } from './ParcelamentosCard';

export async function carregarCaixaPostal(sb: SupabaseClient, companyId: string): Promise<{
  mensagens: MensagemReceitaVm[]; consultadaEm: string | null; temCertificado: boolean; erro: boolean;
  ultimoSitfis: RelatorioSitfisVm | null;
  parcelamentos: ParcelamentoVm[]; parcelamentosConsultadosEm: string | null;
}> {
  const [{ data, error }, { data: fiscal }, { data: cert }, { data: sitfis }, { data: parcs }] = await Promise.all([
    sb.from('mensagens_receita')
      .select('id, assunto, origem, relevante, data_envio, lida_na_receita, data_ciencia, conteudo, aberta_em')
      .eq('company_id', companyId)
      .order('data_envio', { ascending: false, nullsFirst: false })
      .limit(200),
    sb.from('empresas_fiscais').select('caixa_postal_consultada_em, parcelamentos_consultados_em').eq('empresa_id', companyId).maybeSingle(),
    sb.from('arquivos_auxiliares').select('id').eq('company_id', companyId)
      .not('storage_key', 'is', null).is('deleted_at', null).limit(1),
    sb.from('relatorios_situacao_fiscal').select('id, emitido_em, resultado')
      .eq('company_id', companyId).order('emitido_em', { ascending: false }).limit(1).maybeSingle(),
    sb.from('parcelamentos_receita').select('id, modalidade, numero, data_pedido, situacao, data_situacao')
      .eq('company_id', companyId).order('data_pedido', { ascending: false, nullsFirst: false }).limit(50),
  ]);
  if (error) console.error('[caixa postal] leitura das mensagens falhou:', error.message);

  return {
    mensagens: (data ?? []).map((m) => ({
      id: m.id as string,
      assunto: m.assunto as string,
      origem: (m.origem as string | null) ?? null,
      relevante: Boolean(m.relevante),
      dataEnvio: (m.data_envio as string | null) ?? null,
      lidaNaReceita: Boolean(m.lida_na_receita),
      dataCiencia: (m.data_ciencia as string | null) ?? null,
      conteudo: (m.conteudo as string | null) ?? null,
      abertaEm: (m.aberta_em as string | null) ?? null,
    })),
    consultadaEm: (fiscal?.caixa_postal_consultada_em as string | null) ?? null,
    temCertificado: (cert ?? []).length > 0,
    erro: Boolean(error),
    ultimoSitfis: sitfis
      ? { id: sitfis.id as string, emitidoEm: sitfis.emitido_em as string, resultado: sitfis.resultado as RelatorioSitfisVm['resultado'] }
      : null,
    parcelamentos: (parcs ?? []).map((p) => ({
      id: p.id as string, modalidade: p.modalidade as string, numero: p.numero as string,
      dataPedido: (p.data_pedido as string | null) ?? null, situacao: (p.situacao as string | null) ?? null,
      dataSituacao: (p.data_situacao as string | null) ?? null,
    })),
    parcelamentosConsultadosEm: (fiscal?.parcelamentos_consultados_em as string | null) ?? null,
  };
}
