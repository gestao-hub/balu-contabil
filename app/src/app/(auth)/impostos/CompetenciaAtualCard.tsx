// @custom — PR 3.1 — Card da competência atual.
// Server Component. Renderiza apuração + guia do mês corrente, OU CTA
// "Calcular agora" quando nenhum dos dois existe.
import Link from 'next/link';
import { Calculator, FileDown, Receipt } from 'lucide-react';
import { brl, dataBR, statusGuiaBadge, competenciaLabel } from '@/lib/fiscal/guia';
import { fatorRAplicavel } from '@/lib/fiscal/regime';
import type { ApuracaoRow } from './page';
import type { GuiaRow } from './HistoricoGuias';
import GuiaActions from './GuiaActions';
import GerarDasButton from './GerarDasButton';

type Props = {
  apuracao: ApuracaoRow | null;
  guia: GuiaRow | null;
  competencia: string;
  isMei: boolean;
};

export default function CompetenciaAtualCard({ apuracao, guia, competencia, isMei }: Props) {
  if (!apuracao && !guia) {
    return <EmptyCompetencia competencia={competencia} isMei={isMei} />;
  }

  const badge = guia ? statusGuiaBadge(guia.status) : null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="size-4 text-primary" />
            <span className="text-sm font-medium text-muted-foreground-2">{competenciaLabel(competencia)}</span>
            {badge && (
              <span className={`ml-auto sm:ml-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>

          <p className="text-3xl font-semibold text-foreground tabular-nums">
            {brl(guia?.valor ?? apuracao?.valor_imposto ?? null)}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {apuracao?.anexo_simples && (
              <Linha label="Anexo">
                {apuracao.anexo_simples}{fatorRAplicavel(apuracao.anexo_simples) ? ' · Fator R' : ''}
              </Linha>
            )}
            {apuracao?.receita_mes != null && (
              <Linha label="Receita do mês">{brl(apuracao.receita_mes)}</Linha>
            )}
            {apuracao?.rbt12 != null && (
              <Linha label="RBT12">{brl(apuracao.rbt12)}</Linha>
            )}
            {apuracao?.aliquota_efetiva != null && (
              <Linha label="Alíquota efetiva">{(apuracao.aliquota_efetiva * 100).toFixed(2)}%</Linha>
            )}
            {guia?.vencimento && (
              <Linha label="Vencimento">{dataBR(guia.vencimento)}</Linha>
            )}
            {guia?.pagamento && (
              <Linha label="Pago em">{dataBR(guia.pagamento)}</Linha>
            )}
            {guia?.numero && (
              <Linha label="Número">{guia.numero}</Linha>
            )}
          </dl>
        </div>

        <div className="sm:w-56 flex flex-col gap-2 shrink-0">
          {guia ? (
            <GuiaActions guia={guia} variant="primary" />
          ) : isMei ? (
            <GerarDasButton competencia={competencia} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function EmptyCompetencia({ competencia, isMei }: { competencia: string; isMei: boolean }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-surface p-8 text-center">
      <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 mb-3">
        <Calculator className="size-6 text-primary" />
      </div>
      <h3 className="text-base font-semibold text-foreground">Sem cálculo para {competenciaLabel(competencia)}</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
        Quando você consolidar receitas e calcular o DAS, a apuração e a guia desta competência aparecem aqui.
      </p>
      <Link
        href="/impostos/novo"
        className="inline-flex items-center gap-2 mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        <FileDown className="size-4" />
        Calcular agora
      </Link>
      {isMei && (
        <div className="mt-3">
          <GerarDasButton competencia={competencia} />
        </div>
      )}
    </div>
  );
}
