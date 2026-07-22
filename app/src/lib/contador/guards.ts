// src/lib/contador/guards.ts
import 'server-only';
import { createServerClient } from '@/lib/supabase/server';

export type ContabilidadeCtx = {
  userId: string;
  contabilidade: { id: string; nome: string; status: 'pendente' | 'aprovada' | 'suspensa';
    logo_url: string | null; whatsapp_suporte: string | null; email_remetente_nome: string | null } | null;
};

/** Contexto do usuário logado + sua contabilidade (null se não é membro de nenhuma). */
export async function getContabilidadeCtx(): Promise<ContabilidadeCtx | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data } = await supabase
    .from('contabilidade_membros')
    .select('contabilidade_id, contabilidades ( id, nome, status, logo_url, whatsapp_suporte, email_remetente_nome )')
    .eq('user_id', user.id)
    .maybeSingle();
  const c = (data?.contabilidades ?? null) as ContabilidadeCtx['contabilidade'];
  return { userId: user.id, contabilidade: c };
}
