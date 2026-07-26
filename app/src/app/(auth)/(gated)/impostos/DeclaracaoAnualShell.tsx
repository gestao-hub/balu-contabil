// Casca comum das duas declarações anuais. DASN e DEFIS diferem só pelo children.
import { CalendarClock } from 'lucide-react';

export type EstadoDeclaracao = 'rascunho' | 'entregue' | 'em_atraso';

const BADGE: Record<EstadoDeclaracao, { label: string; cls: string }> = {
  rascunho:  { label: 'Rascunho',  cls: 'bg-surface-3 text-muted-foreground' },
  entregue:  { label: 'Entregue',  cls: 'bg-green-500/10 text-green-600' },
  em_atraso: { label: 'Em atraso', cls: 'bg-destructive/10 text-destructive' },
};

export default function DeclaracaoAnualShell({
  titulo, anoCalendario, prazo, norma, estado, children, rodape,
}: {
  titulo: string;
  anoCalendario: number;
  prazo: string;
  norma: string;
  estado: EstadoDeclaracao;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}) {
  const badge = BADGE[estado];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {titulo} — ano-calendário {anoCalendario}
            </h3>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Entregue até <strong>{prazo}</strong>. <span className="text-muted-foreground-2">{norma}</span>
          </p>
          <div className="mt-4">{children}</div>
          {rodape && <div className="mt-4 flex flex-wrap items-center gap-2">{rodape}</div>}
        </div>
      </div>
    </div>
  );
}
