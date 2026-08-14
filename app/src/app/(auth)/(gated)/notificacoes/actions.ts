'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

export async function marcarNotificacaoLidaAction(id: string): Promise<Result> {
  if (!id) return { ok: false, error: 'ID ausente.' };

  const supabase = await createServerClient();

  // Quem impede marcar a notificação de outra pessoa é a RLS
  // (`notifications_update_own`, 0045) — este UPDATE não filtra por dono de
  // propósito, e não precisa.
  //
  // O `.select('id')` é para o RETORNO ser verdadeiro. UPDATE que não casa nada
  // não é erro no PostgREST (`error` volta null), então com o id de outra
  // pessoa a RLS bloqueava a escrita — correto — e a action respondia
  // `ok: true` mesmo assim. Nada de dano: nenhum dado alheio era tocado
  // (verificado). Mas dizer "marquei" sem ter marcado é o mesmo defeito que
  // valeu cinco correções do lado do contador em 14/08/2026, onde as actions
  // ainda gravavam auditoria em cima — ali o registro falso ia parar no
  // audit_log. Aqui só a tela mentia; ainda assim, mente.
  const { data, error } = await supabase
    .from('notifications')
    .update({ lida_em: new Date().toISOString() })
    .eq('id', id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Notificação não encontrada.' };

  revalidatePath('/notificacoes');
  return { ok: true };
}

export async function marcarTodasLidasAction(): Promise<Result> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('notifications')
    .update({ lida_em: new Date().toISOString() })
    .is('lida_em', null)
    .eq('owner_user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/notificacoes');
  return { ok: true };
}
