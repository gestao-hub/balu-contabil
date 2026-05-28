// @custom — PR 3.1 — Helpers puros do dashboard de impostos.
// Sem deps React/Supabase — testável isoladamente.

export type StatusGuia = 'pendente' | 'gerada' | 'paga' | 'vencida' | 'erro' | (string & {});

export type StatusBadge = {
  label: string;
  cls: string; // classes Tailwind
};

/**
 * Mapeia status de `guias_fiscais` → label + classes do badge.
 * Statuses fora do conjunto canônico caem no fallback (cinza).
 */
export function statusGuiaBadge(status: string | null | undefined): StatusBadge {
  const s = (status ?? '').toLowerCase();
  switch (s) {
    case 'paga':       return { label: 'Paga',      cls: 'bg-success/10 text-success' };
    case 'gerada':     return { label: 'Gerada',    cls: 'bg-primary/10 text-primary' };
    case 'pendente':   return { label: 'Pendente',  cls: 'bg-alert/10 text-alert' };
    case 'vencida':    return { label: 'Vencida',   cls: 'bg-destructive/10 text-destructive' };
    case 'erro':       return { label: 'Erro',      cls: 'bg-destructive/10 text-destructive' };
    default:           return { label: status || '—', cls: 'bg-zinc-100 text-zinc-600' };
  }
}

/** Competência canônica YYYYMM (ex: "202605") a partir de uma Date em BRT. */
export function competenciaReferenciaBrt(d: Date = new Date()): string {
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/** Label legível ("Maio/2026") a partir de YYYYMM. */
export function competenciaLabel(referencia: string | null | undefined): string {
  const r = (referencia ?? '').padStart(6, '0');
  if (!/^\d{6}$/.test(r)) return referencia ?? '—';
  const y = r.slice(0, 4);
  const m = Number(r.slice(4, 6));
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  if (m < 1 || m > 12) return referencia ?? '—';
  return `${meses[m - 1]}/${y}`;
}

/** Formata número como R$ pt-BR. Aceita null. */
export function brl(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Formata uma data ISO ou Date pt-BR (DD/MM/YYYY). */
export function dataBR(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * "Vencida"? Compara data_vencimento com hoje (BRT). Considera vencida quando
 * vencimento < hoje E status != 'paga'.
 */
export function isGuiaVencida(
  vencimento: string | null | undefined,
  status: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!vencimento) return false;
  if ((status ?? '').toLowerCase() === 'paga') return false;
  const venc = new Date(vencimento + 'T23:59:59-03:00');
  if (Number.isNaN(venc.getTime())) return false;
  return venc.getTime() < now.getTime();
}
