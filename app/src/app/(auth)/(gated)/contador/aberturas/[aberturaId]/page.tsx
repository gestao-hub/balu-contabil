// @custom — Detalhe de uma abertura (operador). Guard + scope check à carteira,
// signed URLs dos documentos e alterações pendentes. Reads via admin client.
import { redirect, notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { signedUrlAbertura } from '@/lib/clients/supabase-storage';
import { registrarAuditoria } from '@/lib/security/audit';
import { DOC_KEYS, type DocKey } from '@/types/abertura';
import DetalheAbertura, { type AberturaDetalhe, type DocLink, type AlteracaoItem } from './DetalheAbertura';

export const dynamic = 'force-dynamic';

const DOC_LABEL: Record<DocKey, string> = {
  doc_rg_frente: 'RG (frente)', doc_rg_verso: 'RG (verso)',
  doc_cnh_frente: 'CNH (frente)', doc_cnh_verso: 'CNH (verso)',
  doc_cpf: 'CPF', doc_comprovante_titular: 'Comprovante de residência do titular',
  doc_comprovante_sede: 'Comprovante de endereço da sede', doc_declaracao_uso: 'Declaração de uso do endereço',
};

export default async function ContadorAberturaDetalhePage(
  { params }: { params: Promise<{ aberturaId: string }> },
) {
  const { aberturaId } = await params;
  const g = await getContabilidadeCtx();
  if ('error' in g) redirect('/login');
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada') redirect('/contador');

  const admin = createAdminClient();
  const { data: ab } = await admin.from('abertura_empresas').select('*').eq('id', aberturaId).maybeSingle();
  if (!ab) notFound();
  const row = ab as Record<string, unknown>;
  const companyId = (row.company_id as string | null) ?? null;
  if (!companyId) notFound();

  const { data: comp } = await admin.from('companies')
    .select('id, contabilidade_id, status, cnpj').eq('id', companyId).maybeSingle();
  const company = comp as { id: string; contabilidade_id: string | null; status: string | null; cnpj: string | null } | null;
  if (!company || company.contabilidade_id !== g.contabilidade.id) notFound(); // anti-IDOR

  // Signed URLs dos documentos enviados.
  const docs: DocLink[] = [];
  for (const k of DOC_KEYS) {
    const path = row[k] as string | null;
    if (!path) continue;
    const url = await signedUrlAbertura(path);
    if (url) docs.push({ key: k, label: DOC_LABEL[k], url });
  }

  const { data: alts } = await admin.from('abertura_alteracoes')
    .select('id, dados, status, observacoes, created_at').eq('abertura_id', aberturaId)
    .order('created_at', { ascending: false });
  const alteracoes = (alts ?? []) as AlteracaoItem[];

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'abertura.acessar', alvoTipo: 'company',
    alvoId: companyId, contabilidadeId: g.contabilidade.id,
  });

  const detalhe: AberturaDetalhe = {
    id: aberturaId,
    companyStatus: company.status,
    companyCnpj: company.cnpj,
    processoEtapa: (row.processo_etapa as string | null) ?? 'recebido',
    processoProtocolo: (row.processo_protocolo as string | null) ?? null,
    processoObservacoes: (row.processo_observacoes as string | null) ?? null,
    processoCnpjEmitido: (row.processo_cnpj_emitido as string | null) ?? null,
    titular_nome_completo: (row.titular_nome_completo as string | null) ?? null,
    titular_cpf: (row.titular_cpf as string | null) ?? null,
    titular_telefone: (row.titular_telefone as string | null) ?? null,
    titular_email: (row.titular_email as string | null) ?? null,
    empresa_razao_social_1: (row.empresa_razao_social_1 as string | null) ?? null,
    empresa_nome_fantasia: (row.empresa_nome_fantasia as string | null) ?? null,
    empresa_tipo: (row.empresa_tipo as string | null) ?? null,
    empresa_regime_tributario: (row.empresa_regime_tributario as string | null) ?? null,
    empresa_capital_social: row.empresa_capital_social != null ? String(row.empresa_capital_social) : null,
    empresa_cnae_principal: (row.empresa_cnae_principal as string | null) ?? null,
    empresa_objeto_social: (row.empresa_objeto_social as string | null) ?? null,
    sede_cidade: (row.sede_cidade as string | null) ?? null,
    sede_uf: (row.sede_uf as string | null) ?? null,
  };

  return <DetalheAbertura detalhe={detalhe} docs={docs} alteracoes={alteracoes} />;
}
