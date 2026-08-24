// src/app/(auth)/contador/clientes/[companyId]/page.tsx
// Drill-down somente-leitura: contador vê notas/guias/declarações de um cliente da carteira.
// RLS (migração 0033) já restringe as tabelas-filho a `contabilidade_id = minha_contabilidade()`;
// a checagem extra abaixo evita que o header vaze dados de uma empresa que o usuário POSSUI
// (policy de dono em `companies`) mas que não está na carteira do escritório.
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { MSG_ASSINATURA_PENDENTE, MSG_SUBCONTA_NAO_APROVADA } from '@/lib/billing/mensagens';
import { registrarAuditoria } from '@/lib/security/audit';
import type { TipoValor } from '@/lib/billing/avulso';
import VisaoCliente from './VisaoCliente';
import type { ServicoOpcao } from './CobrarDialog';
import type { CertInfo } from './CertificadoCliente';
import type { CredencialFocusInfo } from './CredencialFocusCard';
import { lerEstadoFiscal, decidirCredencial, MENSAGEM_RECUSA } from '@/lib/fiscal/resolver-credencial';

export default async function ClienteDrillDown(
  { params, searchParams }: { params: Promise<{ companyId: string }>;
    searchParams: Promise<{ tab?: string }> },
) {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx || !ctx.contabilidade || ctx.contabilidade.status !== 'aprovada') redirect('/contador');
  const { companyId } = await params;
  const { tab = 'notas' } = await searchParams;
  const supabase = await createServerClient();
  const { data: empresa } = await supabase.from('companies')
    // `user_id` entra só para decidir a ORIGEM do certificado (dono × escritório)
    // na aba Certificado; não vai para o componente.
    .select('id, nome, razao_social, cnpj, contabilidade_id, user_id').eq('id', companyId).maybeSingle();
  if (!empresa) notFound();
  // Guarda de escopo: `companies` também tem policy de SELECT para o dono da empresa —
  // sem isto, uma empresa do próprio contador (fora da carteira) passaria no maybeSingle().
  if (empresa.contabilidade_id !== ctx.contabilidade.id) notFound();

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'cliente.acessar',
    alvoTipo: 'company', alvoId: companyId, contabilidadeId: ctx.contabilidade.id,
  });

  const [{ data: notas }, { data: guias }, { data: declaracoes }, catalogo, subconta, gate, { data: certRow }, { data: fiscalRow }, { data: credRow }] = await Promise.all([
    supabase.from('notas_fiscais')
      .select('id, tipo_documento, data_emissao, status, valor_total')
      .eq('company_id', companyId).order('data_emissao', { ascending: false }).limit(50),
    supabase.from('guias_fiscais')
      .select('id, competencia_referencia, data_vencimento, data_pagamento, status')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('data_vencimento', { ascending: false }).limit(24),
    supabase.from('declaracoes_fiscais')
      // `dados` é o rascunho do cliente: o registro de comprovante pelo contador
      // reenvia esses valores, nunca inventa os declarados (ver VisaoCliente).
      .select('id, tipo, competencia_referencia, data_transmissao, status, dados')
      .eq('company_id', companyId).order('competencia_referencia', { ascending: false }).limit(24),
    // Bloco 4B — o que a tela de emissão oferece. SÓ OS ATIVOS: desativar é o
    // "remover" do catálogo, e a action recusa serviço desativado — oferecê-lo
    // aqui seria convidar a um erro que só aparece no envio.
    // Leitura pela SESSÃO (policy `servicos_avulsos_select_dono` da 0053), com
    // o `.eq('contabilidade_id')` junto: RLS e filtro concordando.
    supabase.from('servicos_avulsos')
      .select('id, nome, tipo_valor, valor_centavos, percentual')
      .eq('contabilidade_id', ctx.contabilidade.id).eq('ativo', true)
      .order('nome', { ascending: true }),
    supabase.from('contabilidades')
      .select('asaas_subconta_status').eq('id', ctx.contabilidade.id).maybeSingle(),
    // O gate de inadimplência do 4A alcança EMITIR COBRANÇA NOVA (decisão do
    // usuário, 27/07) — e é dito na entrada, não depois de preencher.
    assertAssinaturaEscritorio(ctx.contabilidade.id),
    // Certificado A1 do cliente. Leitura pela SESSÃO: a policy
    // `arquivos_aux_select_contador` já dá SELECT ao escritório dono da carteira
    // (conferida no banco em 13/08/2026). Nenhum campo de chave privada sai
    // daqui — só metadado de validade e procedência.
    supabase.from('arquivos_auxiliares')
      .select('storage_key, cert_not_after, cert_cnpj, cert_enviado_por, cert_enviado_em, updated_at')
      .eq('company_id', companyId).is('deleted_at', null).maybeSingle(),
    // Bloco 5 — origem da Focus e a declaração de produção. `empresas_fiscais`
    // segue lida pela SESSÃO (`empresas_fiscais_select_contador`, 0033): não
    // guarda segredo, só metadado.
    supabase.from('empresas_fiscais')
      .select('focus_origem, focus_ambiente, focus_producao_declarada, focus_empresa_id')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    // `empresa_credenciais_focus` e fechada para authenticated (0097): esta
    // leitura EXIGE client de service role. Com o client de sessao ela volta
    // vazia e a tela mentiria dizendo "nenhum token guardado".
    createAdminClient()
      .from('empresa_credenciais_focus')
      .select('token_hom_cifrado, token_prod_cifrado')
      .eq('empresa_id', companyId).maybeSingle(),
  ]);

  // Falha de leitura do catálogo NÃO pode chegar como "catálogo vazio": o
  // escritório cobraria por valor livre um serviço que ele já cadastrou, e a
  // cobrança nasceria sem `servico_avulso_id`.
  if (catalogo.error) console.error('[4b] ler catalogo de avulsos falhou:', catalogo.error.message);

  const servicos: ServicoOpcao[] = (catalogo.data ?? []).map((s) => ({
    id: s.id as string,
    nome: s.nome as string,
    tipoValor: s.tipo_valor as TipoValor,
    valorCentavos: (s.valor_centavos as number | null) ?? null,
    percentual: s.percentual == null ? null : Number(s.percentual),
  }));

  // FALHA FECHADA: erro de leitura da subconta vira "não pode cobrar", nunca
  // "pode". O custo de errar para o lado seguro é um refresh; para o outro, é a
  // cobrança falhar na frente do cliente do escritório.
  const subcontaAprovada = subconta.data?.asaas_subconta_status === 'aprovada';
  const podeCobrar = subcontaAprovada && gate.ok;
  const motivoBloqueio = !gate.ok
    ? MSG_ASSINATURA_PENDENTE
    : !subcontaAprovada ? MSG_SUBCONTA_NAO_APROVADA : null;
  const linkBloqueio = !gate.ok
    ? { href: '/contador/assinatura', rotulo: 'Ver assinatura' }
    : !subcontaAprovada
      ? { href: '/contador/configuracoes/subconta', rotulo: 'Configurar conta de recebimento' }
      : null;

  // Origem do certificado: quem subiu foi o dono da empresa ou alguém do
  // escritório? `cert_enviado_por` é NULL em linha anterior à 0085 — e aí a tela
  // diz "origem não registrada" em vez de chutar um responsável.
  const enviadoPor = (certRow?.cert_enviado_por as string | null) ?? null;
  const cert: CertInfo = {
    presente: Boolean(certRow?.storage_key),
    validoAte: (certRow?.cert_not_after as string | null) ?? null,
    certCnpj: (certRow?.cert_cnpj as string | null) ?? null,
    enviadoEm: (certRow?.cert_enviado_em as string | null) ?? null,
    origem: !enviadoPor ? 'desconhecido' : enviadoPor === empresa.user_id ? 'cliente' : 'escritorio',
  };

  // Bloco 5 — nunca a coluna cifrada aqui: só booleanos. Mandar
  // `token_*_cifrado` para o Client Component colocaria o segredo no HTML do
  // navegador, mesmo que a tela nunca o exiba.
  const origemFocus = (fiscalRow?.focus_origem as 'propria' | 'balu' | null) ?? 'balu';
  const ambienteFocus = (fiscalRow?.focus_ambiente as string | null) === 'prod' ? 'prod' : 'hom';

  // POR QUE PRODUÇÃO ESTÁ (OU NÃO) AO ALCANCE — respondido aqui, no servidor,
  // com a MESMA guarda que decide a emissão. A alternativa era a tela oferecer
  // "Produção", a pessoa salvar, e o "não" aparecer semanas depois na primeira
  // nota. Roda a guarda contra o estado real da empresa, só com `ambiente` em
  // 'prod' — nada é gravado, é uma pergunta.
  let bloqueioProducao: string | null = null;
  if (ambienteFocus !== 'prod') {
    const leitura = await lerEstadoFiscal(companyId, createAdminClient());
    const veredito = leitura.ok
      ? decidirCredencial({ ...leitura.estado, origem: origemFocus, ambiente: 'prod' })
      : ({ ok: false, motivo: leitura.motivo } as const);
    if (!veredito.ok) bloqueioProducao = MENSAGEM_RECUSA[veredito.motivo];
  }

  const credencialFocus: CredencialFocusInfo = {
    companyId,
    origem: origemFocus,
    ambiente: ambienteFocus,
    temHom: Boolean(credRow?.token_hom_cifrado),
    temProd: Boolean(credRow?.token_prod_cifrado),
    producaoDeclarada: Boolean(fiscalRow?.focus_producao_declarada),
    cadastradaNaContaBalu: fiscalRow?.focus_empresa_id != null,
    bloqueioProducao,
  };

  return (
    <VisaoCliente
      empresa={empresa}
      tab={tab}
      notas={notas ?? []}
      guias={guias ?? []}
      declaracoes={declaracoes ?? []}
      cobranca={{ servicos, podeCobrar, motivoBloqueio, linkBloqueio }}
      cert={cert}
      credencialFocus={credencialFocus}
    />
  );
}
