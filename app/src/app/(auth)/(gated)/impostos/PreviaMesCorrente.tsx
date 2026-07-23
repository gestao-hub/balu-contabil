// @custom — Prévia discreta do mês corrente (estimativa comitada). Não é obrigação.
import Link from 'next/link';
import { brl, competenciaLabel } from '@/lib/fiscal/guia';

export default function PreviaMesCorrente({
  competencia,
  estimativa,
}: {
  competencia: string;
  estimativa: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Mês corrente (prévia)</span>
      <span className="font-medium text-foreground">{competenciaLabel(competencia)}</span>
      {estimativa != null ? (
        <>
          <span className="tabular-nums text-foreground">· estimativa {brl(estimativa)}</span>
          <span className="text-muted-foreground-2">· não vence ainda</span>
        </>
      ) : (
        <Link href="/impostos/novo" className="text-primary hover:underline">
          · calcular agora
        </Link>
      )}
    </div>
  );
}
