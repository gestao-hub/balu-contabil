// @custom — Detalhe de uma competência: apuração + declaração + DAS.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaLabel } from '@/lib/fiscal/guia';
import { derivarObrigacoes } from '@/lib/fiscal/obrigacoes';
import SecaoApuracao from '../SecaoApuracao';
import SecaoDeclaracao from '../SecaoDeclaracao';
import SecaoDas from '../SecaoDas';
import { toApuracaoRowDetalhe, toGuiaRowDetalhe } from '../mappers';
import type { ApuracaoRow } from '../page';
import type { GuiaRow } from '../HistoricoGuias';

const BADGE: Record<string, { label: string; cls: string }> = {
  vencida:    { label: 'Vencida',    cls: 'bg-destructive/10 text-destructive' },
  a_pagar:    { label: 'A pagar',    cls: 'bg-primary/10 text-primary' },
  a_declarar: { label: 'A declarar', cls: 'bg-alert/10 text-alert' },
  paga:       { label: 'Paga',       cls: 'bg-success/10 text-success' },
};

export default async function CompetenciaDetalhe({ params }: { params: Promise<{ competencia: string }> }) {
  const { competencia } = await params;
  if (!/^\d{6}$/.test(competencia)) redirect('/impostos');

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) redirect('/impostos');

  const [{ data: apRow }, { data: guiaRow }, { data: decRow }] = await Promise.all([
    supabase.from('apuracoes_fiscais')
      .select('id, competencia_referencia, anexo_simples, aliquota_efetiva, rbt12, receita_mes, valor_imposto, status, payload_calculo')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null).maybeSingle(),
    supabase.from('guias_fiscais')
      .select('id, competencia_referencia, competencia_mes, competencia_ano, valor_total, valor_principal, valor_multa, valor_juros, valor_pago, data_vencimento, data_pagamento, status, numero_das, numero_guia, url_pdf, url_guia, linha_digitavel')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null).maybeSingle(),
    supabase.from('declaracoes_fiscais')
      .select('competencia_referencia, numero_declaracao, data_transmissao')
      .eq('company_id', companyId).eq('competencia_referencia', competencia).eq('tipo', 'PGDAS-D').maybeSingle(),
  ]);

  const apuracao: ApuracaoRow | null = apRow ? toApuracaoRowDetalhe(apRow) : null;
  const guia: GuiaRow | null = guiaRow ? toGuiaRowDetalhe(guiaRow) : null;

  const [obrigacao] = derivarObrigacoes({
    hoje: new Date(),
    competenciasEsperadas: [competencia],
    declaracoes: decRow ? [{ competencia, numeroDeclaracao: (decRow.numero_declaracao as string | null) ?? null, dataTransmissao: (decRow.data_transmissao as string | null) ?? null }] : [],
    guias: guia ? [{ competencia, numeroDas: guia.numero, valor: guia.valor, vencimento: guia.vencimento, pagamento: guia.pagamento, status: guia.status, pdfUrl: guia.pdfUrl }] : [],
    apuracoes: apuracao ? [{ competencia, estimativa: apuracao.valor_imposto }] : [],
  });

  const badge = BADGE[obrigacao.estado] ?? { label: obrigacao.estado, cls: 'bg-surface-3 text-muted-foreground' };

  return (
    <main className="p-6 max-w-3xl">
      <Link href="/impostos" className="inline-flex items-center gap-1 text-sm text-muted-foreground-2 hover:text-foreground">
        <ChevronLeft className="size-4" /> Voltar a Impostos
      </Link>
      <header className="mt-2 mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{competenciaLabel(competencia)}</h1>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      </header>

      <Secao titulo="Apuração (estimativa)"><SecaoApuracao apuracao={apuracao} /></Secao>
      <Secao titulo="Declaração (PGDAS-D)"><SecaoDeclaracao o={obrigacao} /></Secao>
      <Secao titulo="DAS"><SecaoDas guia={guia} /></Secao>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      <div className="rounded-xl border border-border bg-surface p-5">{children}</div>
    </section>
  );
}
