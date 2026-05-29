// @custom — bubble-behavior (Day 1 / PR 1.1 — V1 §5.1)
// Card de métrica reusável do dashboard. Server component (sem estado).
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export type DashboardCardTone = 'default' | 'success' | 'warning' | 'danger';

export type DashboardCardProps = {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  value: string;
  subtitle?: string;
  tone?: DashboardCardTone;
  action?: { label: string; href: string };
};

const TONE: Record<DashboardCardTone, string> = {
  default: 'text-primary bg-primary/10',
  success: 'text-success bg-success/10',
  warning: 'text-alert bg-alert/10',
  danger: 'text-destructive bg-destructive/10',
};

export default function DashboardCard({
  title,
  Icon,
  value,
  subtitle,
  tone = 'default',
  action,
}: DashboardCardProps) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className={`grid size-9 place-items-center rounded-lg ${TONE[tone]}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary transition-all hover:gap-2"
        >
          {action.label}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
