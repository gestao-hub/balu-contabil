// Bloco 4A — resumo da assinatura para a faixa de aviso do layout.
// Devolve null quando nao ha o que avisar — inclusive para empresa de
// carteira, que nao paga.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type ResumoAviso = {
  status: string; trialTerminaEm: string | null; href: string;
  /** Já existe assinatura no Asaas. Sem isto a tarja pedia "assine" a quem
   *  acabou de assinar, e o clique parecia não ter surtido efeito. */
  contratada: boolean;
};

export async function resumoAssinatura(
  userId: string,
  companyId: string | null,
  normalizedRole: string,
): Promise<ResumoAviso | null> {
  try {
    const sb = createAdminClient();

    if (normalizedRole === 'contador') {
      // Escopado pelo usuario: sem o filtro, um cliente admin pegaria o
      // primeiro escritorio da tabela e mostraria a cobranca de outro.
      const { data: m } = await sb.from('contabilidade_membros')
        .select('contabilidade_id').eq('user_id', userId).maybeSingle();
      if (!m) return null;
      const { data: a } = await sb.from('assinaturas')
        .select('status, trial_termina_em, asaas_subscription_id')
        .eq('contabilidade_id', m.contabilidade_id).maybeSingle();
      return a
        ? {
            status: a.status, trialTerminaEm: a.trial_termina_em,
            href: '/contador/assinatura', contratada: Boolean(a.asaas_subscription_id),
          }
        : null;
    }

    if (!companyId) return null;
    const { data: emp } = await sb.from('companies')
      .select('contabilidade_id').eq('id', companyId).maybeSingle();
    // Empresa de carteira nao paga — nada a avisar.
    if (!emp || emp.contabilidade_id) return null;

    const { data: a } = await sb.from('assinaturas')
      .select('status, trial_termina_em, asaas_subscription_id')
      .eq('company_id', companyId).maybeSingle();
    return a
      ? {
          status: a.status, trialTerminaEm: a.trial_termina_em,
          href: '/conta/assinatura', contratada: Boolean(a.asaas_subscription_id),
        }
      : null;
  } catch {
    // A faixa e informativa: falhar em silencio e melhor que derrubar o
    // layout inteiro de todas as paginas autenticadas.
    return null;
  }
}
