// @custom — Um item da fila de obrigações. Server component (só Link).
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { brl, dataBR, competenciaLabel } from '@/lib/fiscal/guia';
import type { ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';

const BADGE: Record<string, { label: string; cls: string }> = {
  vencida:    { label: 'Vencida',    cls: 'bg-destructive/10 text-destructive' },
  a_pagar:    { label: 'A pagar',    cls: 'bg-primary/10 text-primary' },
  a_declarar: { label: 'A declarar', cls: 'bg-alert/10 text-alert' },
};

export default function ObrigacaoItem({ o }: { o: ObrigacaoFiscal }) {
  const badge = BADGE[o.estado] ?? { label: o.estado, cls: 'bg-surface-3 text-muted-foreground' };
  const valor = o.valor != null ? brl(o.valor) : o.estimativaLocal != null ? `~${brl(o.estimativaLocal)} (estim.)` : '—';
  const acaoLabel = o.estado === 'a_declarar' ? 'Transmitir PGDAS-D' : 'Baixar DAS';

  return (
    <Link
      href={`/impostos/${o.competencia}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{competenciaLabel(o.competencia)}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground-2 tabular-nums">
          {valor}{o.vencimento ? ` · ${o.estado === 'vencida' ? 'venceu' : 'vence'} ${dataBR(o.vencimento)}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-sm font-medium text-primary">{acaoLabel}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
