'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

export async function marcarNotificacaoLidaAction(id: string): Promise<Result> {
  if (!id) return { ok: false, error: 'ID ausente.' };

  const supabase = await createServerClient();

  const { error } = await supabase
    .from('notifications')
    .update({ lida_em: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

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
