// @custom — Seção DAS do detalhe. Valores + datas + Baixar PDF (reusa GuiaActions).
import { brl, dataBR } from '@/lib/fiscal/guia';
import GuiaActions from './GuiaActions';
import type { GuiaRow } from './HistoricoGuias';

export default function SecaoDas({ guia }: { guia: GuiaRow | null }) {
  if (!guia || (guia.valor == null && !guia.numero)) {
    return <p className="text-sm text-muted-foreground">O DAS nasce após a declaração.</p>;
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Linha label="Documento">{guia.numero ?? '—'}</Linha>
        <Linha label="Total">{brl(guia.valor)}</Linha>
        <Linha label="Principal">{brl(guia.principal)}</Linha>
        <Linha label="Multa">{brl(guia.multa)}</Linha>
        <Linha label="Juros">{brl(guia.juros)}</Linha>
        <Linha label="Vencimento">{dataBR(guia.vencimento)}</Linha>
        <Linha label="Pago em">{dataBR(guia.pagamento)}</Linha>
      </dl>
      <div className="flex flex-wrap gap-2">
        <GuiaActions guia={guia} variant="primary" />
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
