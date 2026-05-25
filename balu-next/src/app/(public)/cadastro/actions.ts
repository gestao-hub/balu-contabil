// @custom — implementado pela skill bubble-behavior
'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

export type SignupState = { error?: string } | undefined;

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const full_name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const password_confirm = String(formData.get('password_confirm') ?? '');
  const role_type = String(formData.get('role_type') ?? '').trim();

  if (!full_name || !email || !password) {
    return { error: 'Preencha todos os campos.' };
  }
  if (password.length < 6) {
    return { error: 'A senha deve ter pelo menos 6 caracteres.' };
  }
  if (password !== password_confirm) {
    return { error: 'As senhas não conferem.' };
  }
  // "" = placeholder (não escolhido). Só validamos quando preenchido.
  if (role_type && role_type !== 'Empresa' && role_type !== 'Contador') {
    return { error: 'Tipo de conta inválido.' };
  }

  // O tipo escolhido vai no metadata sob a chave `type`; o trigger no banco lê
  // raw_user_meta_data->>'type' e cria o registro em role_types após o signup
  // (quando ausente, o trigger usa default 'Empresa').
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: role_type ? { full_name, type: role_type } : { full_name } },
  });

  if (error) {
    return { error: error.message };
  }

  redirect('/');
}
