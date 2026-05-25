// @custom — implementado pela skill bubble-behavior
'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

export type SignupState = { error?: string } | undefined;

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const full_name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!full_name || !email || !password) {
    return { error: 'Preencha todos os campos.' };
  }
  if (password.length < 6) {
    return { error: 'A senha deve ter pelo menos 6 caracteres.' };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });

  if (error) {
    return { error: error.message };
  }

  redirect('/');
}
