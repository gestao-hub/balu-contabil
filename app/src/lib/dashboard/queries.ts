// @custom — bubble-behavior (Day 1 / PR 1.1 — V1 §5.1 + §5.2)
// Queries server-side do dashboard. RLS já restringe por empresa do usuário;
// ainda assim filtramos explicitamente por companyId (defesa em profundidade).
import 'server-only';
import type { createServerClient } from '@/lib/supabase/server';
import type { Row } from '@/types/database';
import { daysUntilISO } from '@/lib/fiscal/saude-empresa';

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
    // Receita do mês: notas AUTORIZADAS (= 'ativa' no nosso vocabulário canônico,
    // alinhado com `mapStatusFocus`) emitidas na competência atual.
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
    // Próxima guia em aberto, por vencimento mais próximo. Status canônico
    // de guias_fiscais (PRD §4.25): pendente/gerada/paga/vencida/erro.
    sb
      .from('guias_fiscais')
      .select('*')
      .eq('company_id', companyId)
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

  const [guiasRes, notasPendRes, certRes] = await Promise.all([
    sb
      .from('guias_fiscais')
      .select('id, competencia_referencia, data_vencimento, status')
      .eq('company_id', companyId)
      .neq('status', 'paga')
      .not('data_vencimento', 'is', null)
      .order('data_vencimento', { ascending: true })
      .limit(20),
    // Notas pendentes = aguardando autorização da SEFAZ (canônico: 'pendente').
    sb
      .from('notas_fiscais')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'pendente')
      .limit(50),
    // Validade do certificado A1 (mais recente entre os arquivos ativos).
    sb
      .from('arquivos_auxiliares')
      .select('cert_not_after')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .not('cert_not_after', 'is', null)
      .order('cert_not_after', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  type GuiaPend = Pick<Row<'guias_fiscais'>, 'id' | 'competencia_referencia' | 'data_vencimento' | 'status'>;
  const guias = (guiasRes.data ?? []) as GuiaPend[];
  for (const g of guias) {
    if (!g.data_vencimento) continue;
    const dias = diasAte(g.data_vencimento);
    const comp = g.competencia_referencia ?? '—';
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

  const certNotAfter = (certRes.data as { cert_not_after: string | null } | null)?.cert_not_after ?? null;
  if (certNotAfter) {
    const dias = daysUntilISO(certNotAfter);
    if (dias != null && dias < 0) {
      actions.push({
        id: 'cert-a1-vencido',
        severity: 'danger',
        title: 'Certificado A1 vencido',
        description: 'Certificado digital A1 vencido — a emissão de notas está parada.',
        actionLabel: 'Renovar',
        actionHref: '/configuracoes?tab=fiscal',
      });
    } else if (dias != null && dias < 30) {
      actions.push({
        id: 'cert-a1-vencendo',
        severity: 'warning',
        title: 'Certificado A1 vencendo',
        description: `Certificado A1 vence em ${dias} dia(s).`,
        actionLabel: 'Renovar',
        actionHref: '/configuracoes?tab=fiscal',
      });
    }
  }

  return actions;
}
