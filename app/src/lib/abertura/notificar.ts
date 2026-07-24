// src/lib/abertura/notificar.ts
import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

/** Insere uma notificação in-app de transição da abertura para o titular.
 *  Idempotente por (owner_user_id, chave): reavançar para a mesma etapa não duplica.
 *  Guarda: abertura sem dono (user_id null, office-initiated) não tem destinatário → no-op. */
export async function notificarEtapaAbertura(admin: Admin, args: {
  aberturaId: string;
  ownerUserId: string | null;
  companyId: string | null;
  etapa: string;
  titulo: string;
  corpo: string;
  severidade?: 'info' | 'warning' | 'danger';
}): Promise<void> {
  if (!args.ownerUserId) return; // sem destinatário

  const { error } = await admin
    .from('notifications')
    .upsert(
      {
        owner_user_id: args.ownerUserId,
        company_id: args.companyId,
        tipo: 'abertura_etapa',
        severidade: args.severidade ?? 'info',
        titulo: args.titulo,
        corpo: args.corpo,
        action_href: '/configuracoes',
        entidade_ref: args.aberturaId,
        chave: `abertura_etapa:${args.aberturaId}:${args.etapa}`,
      },
      { onConflict: 'owner_user_id,chave', ignoreDuplicates: true },
    );
  // upsert com ignoreDuplicates não gera 23505; se der outro erro, apenas logamos —
  // a notificação nunca deve derrubar a action de negócio que a chamou.
  if (error) console.warn('[abertura] falha ao notificar etapa:', error.message);
}
