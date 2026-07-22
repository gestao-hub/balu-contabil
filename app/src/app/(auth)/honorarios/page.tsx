import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { statusHonorario, type StatusHonorario } from '@/lib/fiscal/status-honorario';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';

const STATUS_LABEL: Record<StatusHonorario, string> = { pago: 'Pago', atrasado: 'Atrasado', aberto: 'Aberto' };
const STATUS_BADGE: Record<StatusHonorario, string> = {
  pago:     'bg-success/10 text-success border-success/30',
  atrasado: 'bg-destructive/10 text-destructive border-destructive/30',
  aberto:   'bg-alert/10 text-alert border-alert/30',
};

function mesLabel(d: string) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function dataBR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${(day ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`;
}

export default async function HonorariosPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  // Membro de escritório (mesmo pendente/suspenso) usa a visão v2 do contador —
  // ela mesma decide o próximo redirect (cadastro/aguardando) conforme o status.
  if (ctx.contabilidade) redirect('/contador/honorarios');

  const supabase = await createServerClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', ctx.userId)
    .single();
  const companyId = (profile?.current_company as string | null) ?? '';
  if (!companyId) redirect('/');

  // RLS honorarios_select_empresario cobre este SELECT (empresa_cliente_id em
  // companies do próprio usuário) — cliente comum, sem privilégio extra.
  const { data: honorariosRaw } = await supabase
    .from('honorarios')
    .select('id, mes_referencia, valor, data_vencimento, data_pagamento, contabilidade_id')
    .eq('empresa_cliente_id', companyId)
    .order('data_vencimento', { ascending: false });

  const rows = honorariosRaw ?? [];

  // Nome do escritório: o empresário não é membro de `contabilidade_membros`, então
  // a RLS de `contabilidades` (contabilidades_select_membro) não libera esse SELECT
  // pelo client comum — leitura pontual via admin, mesmo padrão da página pública
  // de convite ((public)/convite/[token]/page.tsx).
  let escritorioNome: string | null = null;
  const contabilidadeId = (rows[0] as { contabilidade_id?: string | null } | undefined)?.contabilidade_id ?? null;
  if (contabilidadeId) {
    const admin = createAdminClient();
    const { data: cont } = await admin
      .from('contabilidades')
      .select('nome')
      .eq('id', contabilidadeId)
      .maybeSingle();
    escritorioNome = (cont?.nome as string | null) ?? null;
  }

  const honorarios = rows.map(r => {
    const raw = r as Record<string, unknown>;
    return {
      id:              raw.id as string,
      mes_referencia:  raw.mes_referencia as string,
      valor:           String(raw.valor),
      data_vencimento: raw.data_vencimento as string,
      data_pagamento:  (raw.data_pagamento as string | null) ?? null,
    };
  });

  return (
    <main className="p-6 max-w-4xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Honorários</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {escritorioNome ? `Cobranças de ${escritorioNome}` : 'Cobranças do seu escritório de contabilidade'}
        </p>
      </header>

      {honorarios.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhuma cobrança do seu escritório por aqui ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Competência</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-left">Vencimento</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {honorarios.map(h => {
                const st = statusHonorario(h);
                return (
                  <tr key={h.id} className="bg-surface">
                    <td className="px-4 py-3 text-muted-foreground capitalize">{mesLabel(h.mes_referencia)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(valorToCentavos(h.valor))}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dataBR(h.data_vencimento)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[st]}`}>
                        {STATUS_LABEL[st]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
