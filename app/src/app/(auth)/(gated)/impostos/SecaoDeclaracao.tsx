// @custom — Seção Declaração (PGDAS-D) do detalhe. Mostra a declaração ou a ação Transmitir (dry-run até a Fase 2).
import { dataBR } from '@/lib/fiscal/guia';
import PreviewDeclaracaoButton from './PreviewDeclaracaoButton';
import type { ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';

export default function SecaoDeclaracao({ o }: { o: ObrigacaoFiscal }) {
  if (o.declarada) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nº declaração</dt>
          <dd className="font-medium text-foreground">{o.numeroDeclaracao ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Transmitida em</dt>
          <dd className="font-medium text-foreground tabular-nums">{dataBR(o.dataTransmissao)}</dd>
        </div>
      </dl>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Ainda não transmitida.</p>
      {/* Até a Fase 2: o botão abre o dry-run/prévia (indicadorTransmissao=false). */}
      <PreviewDeclaracaoButton competencia={o.competencia} />
    </div>
  );
}
