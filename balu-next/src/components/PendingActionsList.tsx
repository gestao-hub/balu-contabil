// @custom — bubble-behavior (Day 1 / PR 1.1 — V1 §5.2 "O que você precisa fazer")
// Server component: lista pendências com severidade + CTA. Sem estado.
import Link from 'next/link';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, ArrowRight } from 'lucide-react';
import type { PendingAction, PendingSeverity } from '@/lib/dashboard/queries';

const SEVERITY: Record<PendingSeverity, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  danger: { Icon: AlertCircle, color: 'text-destructive' },
  warning: { Icon: AlertTriangle, color: 'text-alert' },
  info: { Icon: Info, color: 'text-primary' },
};

export default function PendingActionsList({ actions }: { actions: PendingAction[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-head font-semibold text-foreground">O que você precisa fazer</h2>
      </header>

      {actions.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground-2">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          Tudo em dia. Nenhuma pendência no momento.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {actions.map((a) => {
            const { Icon, color } = SEVERITY[a.severity];
            return (
              <li key={a.id} className="flex items-center gap-4 px-5 py-4">
                <Icon className={`size-5 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                </div>
                <Link
                  href={a.actionHref}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:border-primary"
                >
                  {a.actionLabel}
                  <ArrowRight className="size-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
