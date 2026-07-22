// @custom — implementado pela skill bubble-behavior
'use server';

import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';
import { limitar, ipDe, chaveEmail } from '@/lib/security/rate-limit';

export type ResetState = { error?: string; success?: string } | undefined;

export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Informe seu e-mail.' };

  // Rate-limit por IP+email. Mantemos a mesma resposta neutra de sucesso quando
  // estourado (em vez de erro) para não vazar, via diferença de resposta, se o
  // e-mail existe — mesma postura de neutralidade que o restante deste fluxo já
  // adota (resetPasswordForEmail não revela existência de conta).
  const ip = ipDe(await headers());
  if (!(await limitar(`reset:${ip}:${chaveEmail(email)}`, 5, 3600))) {
    return { success: 'Enviamos um link de redefinição para o seu e-mail.' };
  }

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
