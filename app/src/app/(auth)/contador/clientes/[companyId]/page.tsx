// src/app/(auth)/contador/clientes/[companyId]/page.tsx
// Drill-down somente-leitura: contador vê notas/guias/declarações de um cliente da carteira.
// RLS (migração 0033) já restringe as tabelas-filho a `contabilidade_id = minha_contabilidade()`;
// a checagem extra abaixo evita que o header vaze dados de uma empresa que o usuário POSSUI
// (policy de dono em `companies`) mas que não está na carteira do escritório.
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import VisaoCliente from './VisaoCliente';

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
  const [{ data: notas }, { data: guias }, { data: declaracoes }] = await Promise.all([
    supabase.from('notas_fiscais')
      .select('id, tipo_documento, data_emissao, status, valor_total')
      .eq('company_id', companyId).order('data_emissao', { ascending: false }).limit(50),
    supabase.from('guias_fiscais')
      .select('id, competencia_referencia, data_vencimento, data_pagamento, status')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('data_vencimento', { ascending: false }).limit(24),
    supabase.from('declaracoes_fiscais')
      .select('id, tipo, competencia_referencia, data_transmissao, status')
      .eq('company_id', companyId).order('competencia_referencia', { ascending: false }).limit(24),
  ]);
  return <VisaoCliente empresa={empresa} tab={tab} notas={notas ?? []} guias={guias ?? []} declaracoes={declaracoes ?? []} />;
}
