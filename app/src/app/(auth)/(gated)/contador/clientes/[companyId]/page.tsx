// src/app/(auth)/contador/clientes/[companyId]/page.tsx
// Drill-down somente-leitura: contador vê notas/guias/declarações de um cliente da carteira.
// RLS (migração 0033) já restringe as tabelas-filho a `contabilidade_id = minha_contabilidade()`;
// a checagem extra abaixo evita que o header vaze dados de uma empresa que o usuário POSSUI
// (policy de dono em `companies`) mas que não está na carteira do escritório.
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { MSG_ASSINATURA_PENDENTE, MSG_SUBCONTA_NAO_APROVADA } from '@/lib/billing/mensagens';
import { registrarAuditoria } from '@/lib/security/audit';
import type { TipoValor } from '@/lib/billing/avulso';
import VisaoCliente from './VisaoCliente';
import type { ServicoOpcao } from './CobrarDialog';

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
    .select('id, nome, razao_social, cnpj, contabilidade_id').eq('id', companyId).maybeSingle();
  if (!empresa) notFound();
  // Guarda de escopo: `companies` também tem policy de SELECT para o dono da empresa —
  // sem isto, uma empresa do próprio contador (fora da carteira) passaria no maybeSingle().
  if (empresa.contabilidade_id !== ctx.contabilidade.id) notFound();

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'cliente.acessar',
    alvoTipo: 'company', alvoId: companyId, contabilidadeId: ctx.contabilidade.id,
  });

  const [{ data: notas }, { data: guias }, { data: declaracoes }, catalogo, subconta, gate] = await Promise.all([
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

  return (
    <VisaoCliente
      empresa={empresa}
      tab={tab}
      notas={notas ?? []}
      guias={guias ?? []}
      declaracoes={declaracoes ?? []}
      cobranca={{ servicos, podeCobrar, motivoBloqueio, linkBloqueio }}
    />
  );
}
