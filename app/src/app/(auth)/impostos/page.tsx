// @custom — PR 3.1 — Dashboard de Impostos.
// Server Component: carrega apuração + guia da competência atual + histórico.
// Empty states em 3 níveis:
//   - sem empresa selecionada → CTA "Selecionar empresa"
//   - empresa sem regime fiscal configurado → CTA "Configure o regime"
//   - sem apuração/guia na competência atual → CTA "Calcular agora"
import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaReferenciaBrt, competenciaLabel } from '@/lib/fiscal/guia';
import { tipoFromCode } from '@/lib/fiscal/regime';
import CompetenciaAtualCard from './CompetenciaAtualCard';
import HistoricoGuias, { type GuiaRow } from './HistoricoGuias';
import ConsultarSerproButton from './ConsultarSerproButton';
import DeclaracoesSection, { type DeclaracaoRow } from './DeclaracoesSection';
import DeclaracoesMeiSection from './DeclaracoesMeiSection';

export type ApuracaoRow = {
  id: string;
  competencia_referencia: string;
  anexo_simples: string | null;
  aliquota_efetiva: number | null;
  rbt12: number | null;
  receita_mes: number | null;
  valor_imposto: number | null;
  status: string | null;
  payload_calculo: Record<string, unknown> | null;
};

export default async function ImpostosPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;

  if (!companyId) {
    return (
      <Page>
        <BloqueioEmpresa />
      </Page>
    );
  }

  const competenciaAtual = competenciaReferenciaBrt(new Date());

  const [{ data: company }, { data: fiscal }, { data: apuracoes }, { data: guias }, { data: declaracoes }] = await Promise.all([
    supabase.from('companies').select('razao_social, nome').eq('id', companyId).single(),
    supabase.from('empresas_fiscais')
      .select('Code_regime_tributario, anexo_simples')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    supabase.from('apuracoes_fiscais')
      .select('id, competencia_referencia, anexo_simples, aliquota_efetiva, rbt12, receita_mes, valor_imposto, status, payload_calculo')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('competencia_referencia', { ascending: false })
      .limit(13),
    supabase.from('guias_fiscais')
      .select(`
        id, competencia_referencia, competencia_mes, competencia_ano,
        valor_total, valor_principal, valor_multa, valor_juros, valor_pago,
        data_vencimento, data_pagamento, status, numero_das, numero_guia,
        url_pdf, url_guia, linha_digitavel
      `)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('competencia_referencia', { ascending: false })
      .limit(24),
    supabase.from('declaracoes_fiscais')
      .select('id, competencia_referencia, tipo, numero_declaracao, data_transmissao, status')
      .eq('company_id', companyId)
      .order('competencia_referencia', { ascending: false })
      .limit(24),
  ]);

  const apuracaoAtual = (apuracoes ?? []).find((a) => a.competencia_referencia === competenciaAtual) ?? null;
  const guiaAtual = (guias ?? []).find((g) => g.competencia_referencia === competenciaAtual) ?? null;
  const historico: GuiaRow[] = (guias ?? [])
    .filter((g) => g.competencia_referencia !== competenciaAtual)
    .map(toGuiaRow);

  const declaracoesRows: DeclaracaoRow[] = (declaracoes ?? []).map((d) => ({
    id: d.id as string,
    competencia: (d.competencia_referencia as string) ?? '',
    tipo: (d.tipo as string) ?? 'PGDAS-D',
    numeroDeclaracao: (d.numero_declaracao as string | null) ?? null,
    dataTransmissao: (d.data_transmissao as string | null) ?? null,
    status: (d.status as string | null) ?? null,
  }));

  const empresaNome = (company?.nome as string) ?? (company?.razao_social as string) ?? '—';
  const isMei = (fiscal?.Code_regime_tributario ?? null) === '4';
  const isSimples = tipoFromCode((fiscal?.Code_regime_tributario ?? '') as string) === 'simples';

  return (
    <Page>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Impostos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {empresaNome} · <span className="font-mono">{competenciaLabel(competenciaAtual)}</span>
        </p>
        <Link
          href="/impostos/folha"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-2"
        >
          Folha (Fator R)
        </Link>
      </header>

      {!fiscal && <BloqueioFiscal />}

      {fiscal && (
        <>
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Competência atual</h2>
            <CompetenciaAtualCard
              apuracao={apuracaoAtual ? toApuracaoRow(apuracaoAtual) : null}
              guia={guiaAtual ? toGuiaRow(guiaAtual) : null}
              competencia={competenciaAtual}
              isMei={isMei}
              isSimples={isSimples}
            />
          </section>

          {isSimples && (
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações (PGDAS-D)</h2>
              <DeclaracoesSection declaracoes={declaracoesRows} />
            </section>
          )}
          {isMei && (
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações</h2>
              <DeclaracoesMeiSection
                declaracoes={declaracoesRows.filter((d) => d.tipo === 'DASN-SIMEI')}
                anoCalendario={Number(competenciaAtual.slice(0, 4)) - 1}
              />
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Histórico de guias</h2>
              {isSimples && <ConsultarSerproButton />}
            </div>
            <HistoricoGuias initial={historico} isSimples={isSimples} />
          </section>
        </>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <main className="p-6 max-w-5xl">{children}</main>;
}

function BloqueioEmpresa() {
  return (
    <div className="rounded-lg border border-alert/30 bg-alert/5 p-6">
      <div className="flex items-start gap-3">
        <Receipt className="size-5 text-alert mt-0.5" />
        <div>
          <h1 className="text-lg font-semibold text-alert">Nenhuma empresa selecionada</h1>
          <p className="text-sm text-muted-foreground-2 mt-1">Cadastre ou selecione uma empresa pra ver impostos.</p>
        </div>
      </div>
    </div>
  );
}

function BloqueioFiscal() {
  return (
    <div className="rounded-lg border border-alert/30 bg-alert/5 p-6">
      <div className="flex items-start gap-3">
        <Receipt className="size-5 text-alert mt-0.5" />
        <div>
          <h1 className="text-lg font-semibold text-alert">Configure o regime fiscal</h1>
          <p className="text-sm text-muted-foreground-2 mt-1">
            Antes de calcular impostos, você precisa definir o regime tributário da empresa.
          </p>
          <Link
            href="/configuracoes?tab=regime"
            className="inline-block mt-4 text-sm font-medium text-primary hover:underline"
          >
            Ir para Regime tributário →
          </Link>
        </div>
      </div>
    </div>
  );
}

function numero(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toApuracaoRow(a: Record<string, unknown>): ApuracaoRow {
  return {
    id: a.id as string,
    competencia_referencia: (a.competencia_referencia as string) ?? '',
    anexo_simples: (a.anexo_simples as string | null) ?? null,
    aliquota_efetiva: numero(a.aliquota_efetiva),
    rbt12: numero(a.rbt12),
    receita_mes: numero(a.receita_mes),
    valor_imposto: numero(a.valor_imposto),
    status: (a.status as string | null) ?? null,
    payload_calculo: (a.payload_calculo as Record<string, unknown> | null) ?? null,
  };
}

function toGuiaRow(g: Record<string, unknown>): GuiaRow {
  return {
    id: g.id as string,
    competencia: (g.competencia_referencia as string) ?? null,
    vencimento: (g.data_vencimento as string) ?? null,
    pagamento: (g.data_pagamento as string) ?? null,
    valor: numero(g.valor_total) ?? numero(g.valor_principal),
    status: (g.status as string) ?? null,
    pdfUrl: ((g.url_pdf as string) ?? (g.url_guia as string)) ?? null,
    linhaDigitavel: (g.linha_digitavel as string) ?? null,
    numero: ((g.numero_das as string) ?? (g.numero_guia as string)) ?? null,
  };
}
