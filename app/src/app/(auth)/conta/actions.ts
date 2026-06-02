// src/app/(auth)/conta/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteUrl } from '@/lib/site-url';

export type ContaActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Atualiza o nome de exibição em user_metadata.full_name. */
export async function updateNomeAction(nome: string): Promise<ContaActionResult> {
  const trimmed = nome.trim();
  if (!trimmed) return { ok: false, error: 'Informe um nome.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Envia link de confirmação para o novo email.
 *  O email só muda após o usuário clicar no link recebido. */
export async function updateEmailAction(newEmail: string): Promise<ContaActionResult> {
  const trimmed = newEmail.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return { ok: false, error: 'Informe um email válido.' };

  const supabase = await createServerClient();
  const origin = getSiteUrl();
  const { error } = await supabase.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo: `${origin}/auth/callback?next=/conta` },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Link enviado para ${trimmed}. O email atual permanece ativo até a confirmação.` };
}

/** Atualiza a senha do usuário autenticado, verificando a senha atual primeiro. */
export async function updateSenhaAction(senhaAtual: string, senha: string, confirmar: string): Promise<ContaActionResult> {
  if (!senhaAtual) return { ok: false, error: 'Informe a senha atual.' };
  if (senha.length < 6) return { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
  if (senha !== confirmar) return { ok: false, error: 'As senhas não coincidem.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Sessão expirada.' };

  // Re-autentica com a senha atual antes de permitir a troca.
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: senhaAtual,
  });
  if (authError) return { ok: false, error: 'Senha atual incorreta.' };

  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Exclui permanentemente a conta e todos os dados vinculados (cascade no banco).
 *  Após a exclusão, invalida a sessão e redireciona para /login. */
export async function deleteAccountAction(): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // Invalida os cookies de sessão antes do redirect.
  await supabase.auth.signOut();
  redirect('/login');
}
