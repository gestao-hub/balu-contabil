// src/app/(auth)/admin/contabilidades/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/clients/email';

// Padrão local ao arquivo — segue a convenção dominante do repo: cada
// `actions.ts` declara seu próprio ActionResult (ver contador/actions.ts,
// clientes/actions.ts, onboarding/actions.ts, impostos/actions.ts).
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdminBalu(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: role } = await supabase.from('role_types')
    .select('type').eq('user_id', user.id).maybeSingle();
  if (role?.type !== 'AdminBalu') return { error: 'Acesso restrito.' };
  return { userId: user.id };
}

export async function decidirContabilidadeAction(
  id: string, decisao: 'aprovada' | 'suspensa',
): Promise<ActionResult> {
  const ctx = await requireAdminBalu();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const admin = createAdminClient();
  const { error } = await admin.from('contabilidades')
    .update(decisao === 'aprovada'
      ? { status: 'aprovada', aprovada_em: new Date().toISOString(), aprovada_por: ctx.userId }
      : { status: 'suspensa' })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  // avisa o(s) membro(s) por e-mail
  const { data: membros } = await admin.from('contabilidade_membros').select('user_id').eq('contabilidade_id', id);
  for (const m of membros ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    if (u?.user?.email) await sendEmail({
      to: u.user.email,
      subject: decisao === 'aprovada' ? 'Seu escritório foi aprovado no Balu 🎉' : 'Cadastro do escritório no Balu',
      html: decisao === 'aprovada'
        ? '<p>Seu escritório foi aprovado. Acesse o painel do contador para começar.</p>'
        : '<p>Seu cadastro não foi aprovado neste momento. Responda este e-mail para falar com a gente.</p>',
    });
  }
  revalidatePath('/admin/contabilidades');
  return { ok: true };
}
