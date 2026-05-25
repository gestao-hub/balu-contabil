// @custom — implementado pela skill bubble-behavior
'use server';

import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';

export type ResetState = { error?: string; success?: string } | undefined;

export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Informe seu e-mail.' };

  const hdrs = await headers();
  const origin =
    hdrs.get('origin') ??
    (() => {
      const host = hdrs.get('host');
      const proto = hdrs.get('x-forwarded-proto') ?? 'https';
      return host ? `${proto}://${host}` : '';
    })();

  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset_pw?code=1`,
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
