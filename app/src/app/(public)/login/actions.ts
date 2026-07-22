// @custom — implementado pela skill bubble-behavior
'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/format/safe-next';
import { limitar, ipDe, chaveEmail } from '@/lib/security/rate-limit';

export type AuthState = { error?: string } | undefined;

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');

  if (!email || !password) {
    return { error: 'Informe e-mail e senha.' };
  }

  const ip = ipDe(await headers());
  if (!(await limitar(`login:${ip}:${chaveEmail(email)}`, 10, 300))) {
    return { error: 'Muitas tentativas. Tente novamente em alguns minutos.' };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: traduzirErroSupabase(error.message) };
  }

  redirect(safeNext(next) ?? '/');
}

function traduzirErroSupabase(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (lower.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  return msg;
}
