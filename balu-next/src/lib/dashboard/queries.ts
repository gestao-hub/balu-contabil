// @custom — bubble-behavior (Day 1 / PR 1.1 — V1 §5.1 + §5.2)
// Queries server-side do dashboard. RLS já restringe por empresa do usuário;
// ainda assim filtramos explicitamente por companyId (defesa em profundidade).
import 'server-only';
import type { createServerClient } from '@/lib/supabase/server';
import type { Row } from '@/types/database';

type SB = Awaited<ReturnType<typeof createServerClient>>;

export type DashboardMetrics = {
  receitaMes: number;
  notasMes: number;
  ultimaNota: Row<'notas_fiscais'> | null;
  proximaGuia: Row<'guias_fiscais'> | null;
};

export type PendingSeverity = 'info' | 'warning' | 'danger';
export type PendingAction = {
  id: string;
  severity: PendingSeverity;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
};

/** Limites [início, próximo) do mês corrente em ISO (horário local do servidor). */
function monthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), next: next.toISOString() };
}

/** Converte competência 'YYYYMM' → 'MM/YYYY' para exibição. */
function fmtCompetencia(comp: string | null): string {
  if (!comp || comp.length !== 6) return comp ?? '—';
  return `${comp.slice(4, 6)}/${comp.slice(0, 4)}`;
}

/** Dias entre hoje (00:00) e uma data `YYYY-MM-DD`. Negativo = no passado. */
function diasAte(dateOnly: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateOnly}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export async function getDashboardMetrics(sb: SB, companyId: string): Promise<DashboardMetrics> {
  const { start, next } = monthBounds();

  const [notasMesRes, ultimaRes, guiaRes] = await Promise.all([
    // Receita do mês: notas ATIVAS emitidas na competência atual.
    sb
      .from('notas_fiscais')
      .select('valor_total')
      .eq('company_id', companyId)
      .eq('status', 'ativa')
      .gte('data_emissao', start)
      .lt('data_emissao', next),
    // Última nota emitida (qualquer status), mais recente por data_emissao.
    sb
      .from('notas_fiscais')
      .select('*')
      .eq('company_id', companyId)
      .order('data_emissao', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    // Próxima guia em aberto, por vencimento mais próximo.
    sb
      .from('guias_fiscais')
      .select('*')
      .eq('empresa_id', companyId)
      .neq('status', 'paga')
      .not('data_vencimento', 'is', null)
      .order('data_vencimento', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const notas = (notasMesRes.data ?? []) as { valor_total: number | null }[];
  const receitaMes = notas.reduce((sum, n) => sum + (n.valor_total ?? 0), 0);

  return {
    receitaMes,
    notasMes: notas.length,
    ultimaNota: (ultimaRes.data ?? null) as Row<'notas_fiscais'> | null,
    proximaGuia: (guiaRes.data ?? null) as Row<'guias_fiscais'> | null,
  };
}

export async function getPendingActions(sb: SB, companyId: string): Promise<PendingAction[]> {
  const actions: PendingAction[] = [];

  const [guiasRes, notasPendRes] = await Promise.all([
    sb
      .from('guias_fiscais')
      .select('id, competencia, data_vencimento, status')
      .eq('empresa_id', companyId)
      .neq('status', 'paga')
      .not('data_vencimento', 'is', null)
      .order('data_vencimento', { ascending: true })
      .limit(20),
    sb
      .from('notas_fiscais')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'pendente')
      .limit(50),
  ]);

  type GuiaPend = Pick<Row<'guias_fiscais'>, 'id' | 'competencia' | 'data_vencimento' | 'status'>;
  const guias = (guiasRes.data ?? []) as GuiaPend[];
  for (const g of guias) {
    if (!g.data_vencimento) continue;
    const dias = diasAte(g.data_vencimento);
    const comp = fmtCompetencia(g.competencia);
    if (dias < 0) {
      actions.push({
        id: `guia-${g.id}`,
        severity: 'danger',
        title: `DAS ${comp} vencido`,
        description: `Venceu há ${Math.abs(dias)} dia(s). Pague para evitar juros.`,
        actionLabel: 'Pagar',
        actionHref: '/impostos',
      });
    } else if (dias <= 7) {
      actions.push({
        id: `guia-${g.id}`,
        severity: 'warning',
        title: `DAS ${comp} vence em ${dias} dia(s)`,
        description: 'Pague antes do vencimento para evitar multa.',
        actionLabel: 'Pagar',
        actionHref: '/impostos',
      });
    }
  }

  const notasPend = (notasPendRes.data ?? []) as { id: string }[];
  if (notasPend.length > 0) {
    actions.push({
      id: 'notas-pendentes',
      severity: 'warning',
      title: `${notasPend.length} nota(s) fiscal(is) pendente(s)`,
      description: 'Há notas que ainda não foram autorizadas pela SEFAZ.',
      actionLabel: 'Ver notas',
      actionHref: '/notas_fiscais',
    });
  }

  // TODO(cert-a1): pendência "Certificado A1 vencendo em 30 dias" (V1 §5.2) não é
  // implementável hoje — o schema não armazena a validade do certificado
  // (arquivos_auxiliares só tem cert_password). Adicionar quando existir a coluna.

  return actions;
}
