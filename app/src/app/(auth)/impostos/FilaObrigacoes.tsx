// @custom — Fila "Precisa de atenção": obrigações em estado != paga, ordenadas.
import { CheckCircle2 } from 'lucide-react';
import { ordenarFila, type ObrigacaoFiscal } from '@/lib/fiscal/obrigacoes';
import ObrigacaoItem from './ObrigacaoItem';

export default function FilaObrigacoes({ obrigacoes }: { obrigacoes: ObrigacaoFiscal[] }) {
  const fila = ordenarFila(obrigacoes);

  if (fila.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface p-6">
        <CheckCircle2 className="size-5 text-success" />
        <p className="text-sm text-muted-foreground">Tudo em dia. Nenhuma obrigação em aberto.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {fila.map((o) => (
        <ObrigacaoItem key={o.competencia} o={o} />
      ))}
    </div>
  );
}
