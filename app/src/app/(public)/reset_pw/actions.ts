// @custom — implementado pela skill bubble-behavior
'use server';

import { createServerClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';

export type ResetState = { error?: string; success?: string } | undefined;

export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Informe seu e-mail.' };

  // Base canônica via env (NEXT_PUBLIC_SITE_URL) — derivar de header `Host`/`Origin`
  // é Host Header Injection: atacante manda reset com Host: evil.com e Supabase
  // envia o link de redefinição apontando pro domínio dele.
  const origin = getSiteUrl();

  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // O link do e-mail passa primeiro pelo /auth/callback, que troca o `code`
    // por sessão (cookies) e então redireciona para o form de nova senha.
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/reset_pw?step=update')}`,
  });

  if (error) return { error: error.message };
  return { success: 'Enviamos um link de redefinição para o seu e-mail.' };
}

export async function updatePasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get('password') ?? '');
  if (password.length < 6) return { error: 'A senha deve ter pelo menos 6 caracteres.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message };
  return { success: 'Senha atualizada com sucesso. Você já pode entrar.' };
}
