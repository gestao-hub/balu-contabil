// @custom — Dashboard de Impostos.
// Server Component. Simples: prévia do mês corrente + fila de obrigações (a_declarar/a_pagar/vencida)
// + histórico das pagas. MEI: card da competência atual + declarações (DASN-SIMEI) + histórico.
// Gate inicial SERPRO manda enquanto a empresa Simples não fez o 1º sync.
import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaReferenciaBrt, competenciaLabel } from '@/lib/fiscal/guia';
import { tipoFromCode } from '@/lib/fiscal/regime';
import { derivarObrigacoes, competenciasEsperadasDoAno } from '@/lib/fiscal/obrigacoes';
import HistoricoGuias, { type GuiaRow } from './HistoricoGuias';
import { type DeclaracaoRow } from './DeclaracoesSection';
import DeclaracoesMeiSection from './DeclaracoesMeiSection';
import GateInicialSerpro from './GateInicialSerpro';
import PreviaMesCorrente from './PreviaMesCorrente';
import FilaObrigacoes from './FilaObrigacoes';
import CompetenciaAtualCardMei from './CompetenciaAtualCardMei';
import { toApuracaoRowDetalhe, toGuiaRowDetalhe } from './mappers';

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
      .select('Code_regime_tributario, anexo_simples, sincronizacao_inicial_serpro_at')
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
  // Histórico do MEI: todas as guias exceto a competência atual.
  const historicoMei: GuiaRow[] = (guias ?? [])
    .filter((g) => g.competencia_referencia !== competenciaAtual)
    .map(toGuiaRowDetalhe);

  const declaracoesRows: DeclaracaoRow[] = (declaracoes ?? []).map((d) => ({
    id: d.id as string,
    competencia: (d.competencia_referencia as string) ?? '',
    tipo: (d.tipo as string) ?? 'PGDAS-D',
    numeroDeclaracao: (d.numero_declaracao as string | null) ?? null,
    dataTransmissao: (d.data_transmissao as string | null) ?? null,
    status: (d.status as string | null) ?? null,
  }));

  const empresaNome = (company?.nome as string) ?? (company?.razao_social as string) ?? '—';
  const isSimples = tipoFromCode((fiscal?.Code_regime_tributario ?? '') as string) === 'simples';
  // Gate só para Simples Nacional de fato (codes 1/2). tipoFromCode mapeia code 3
  // (Lucro Real/Presumido) como 'simples', mas Regime Normal não consulta PGDAS-D na SERPRO.
  const regimeCode = (fiscal?.Code_regime_tributario ?? '') as string;
  const mostrarGate = (regimeCode === '1' || regimeCode === '2') && !(fiscal?.sincronizacao_inicial_serpro_at);

  // Obrigações derivadas (Simples): situação por competência a partir das tabelas atuais.
  const obrigacoes = isSimples
    ? derivarObrigacoes({
        hoje: new Date(),
        competenciasEsperadas: competenciasEsperadasDoAno(new Date()),
        // Mês corrente fica fora da fila (não fechou) — vai pra prévia. Filtramos antes de derivar
        // porque o helper inclui defensivamente qualquer competência com declaração/guia.
        declaracoes: declaracoesRows
          .filter((d) => d.tipo === 'PGDAS-D' && d.competencia !== competenciaAtual)
          .map((d) => ({ competencia: d.competencia, numeroDeclaracao: d.numeroDeclaracao, dataTransmissao: d.dataTransmissao })),
        guias: (guias ?? [])
          .filter((g) => (g.competencia_referencia as string) !== competenciaAtual)
          .map((g) => {
          const row = toGuiaRowDetalhe(g);
          return {
            competencia: row.competencia ?? '',
            numeroDas: row.numero,
            valor: row.valor,
            vencimento: row.vencimento,
            pagamento: row.pagamento,
            status: row.status,
            pdfUrl: row.pdfUrl,
          };
        }),
        apuracoes: (apuracoes ?? []).map((a) => ({
          competencia: (a.competencia_referencia as string) ?? '',
          estimativa: a.valor_imposto != null ? Number(a.valor_imposto) : null,
        })),
      })
    : [];

  const obrigacoesAtencao = obrigacoes.filter((o) => o.estado !== 'paga');
  const pagasHistorico: GuiaRow[] = obrigacoes
    .filter((o) => o.estado === 'paga')
    .map((o) => (guias ?? []).find((g) => (g.competencia_referencia as string) === o.competencia))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map(toGuiaRowDetalhe);
  const estimativaMesCorrente = apuracaoAtual?.valor_imposto != null ? Number(apuracaoAtual.valor_imposto) : null;

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
        mostrarGate ? (
          <GateInicialSerpro />
        ) : isSimples ? (
          <>
            <section className="mb-6">
              <PreviaMesCorrente competencia={competenciaAtual} estimativa={estimativaMesCorrente} />
            </section>
            <section className="mb-8">
              <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Precisa de atenção</h2>
              <FilaObrigacoes obrigacoes={obrigacoesAtencao} />
            </section>
            <section>
              <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Histórico</h2>
              <HistoricoGuias initial={pagasHistorico} />
            </section>
          </>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Competência atual</h2>
              <CompetenciaAtualCardMei
                apuracao={apuracaoAtual ? toApuracaoRowDetalhe(apuracaoAtual) : null}
                guia={guiaAtual ? toGuiaRowDetalhe(guiaAtual) : null}
                competencia={competenciaAtual}
              />
            </section>
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações</h2>
              <DeclaracoesMeiSection
                declaracoes={declaracoesRows.filter((d) => d.tipo === 'DASN-SIMEI')}
                anoCalendario={Number(competenciaAtual.slice(0, 4)) - 1}
              />
            </section>
            <section>
              <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Histórico de guias</h2>
              <HistoricoGuias initial={historicoMei} />
            </section>
          </>
        )
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
