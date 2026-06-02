// @custom — implementado pela skill bubble-behavior
'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';

export type SignupState = { error?: string } | undefined;

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const full_name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const password_confirm = String(formData.get('password_confirm') ?? '');
  const role_type = String(formData.get('role_type') ?? '').trim();
  const terms = formData.get('terms');

  if (!full_name || !email || !password) {
    return { error: 'Preencha todos os campos.' };
  }
  if (password.length < 6) {
    return { error: 'A senha deve ter pelo menos 6 caracteres.' };
  }
  if (password !== password_confirm) {
    return { error: 'As senhas não conferem.' };
  }
  if (!terms) {
    return { error: 'Você precisa aceitar os termos de uso.' };
  }
  // "" = placeholder (não escolhido). Só validamos quando preenchido.
  if (role_type && role_type !== 'Empresa' && role_type !== 'Contador') {
    return { error: 'Tipo de conta inválido.' };
  }

  // O tipo escolhido vai no metadata sob a chave `type`; o trigger no banco lê
  // raw_user_meta_data->>'type' e cria o registro em role_types após o signup
  // (quando ausente, o trigger usa default 'Empresa').
  const terms_accepted_at = new Date().toISOString();
  const origin = getSiteUrl();
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: role_type
        ? { full_name, type: role_type, terms_accepted_at }
        : { full_name, terms_accepted_at },
      // Quando "Confirm email" está ON no projeto Supabase, o link enviado pelo
      // template do email aponta pra esta URL (passa por /auth/confirm pra rodar
      // verifyOtp e gravar cookies no domínio do app). Quando OFF, o Supabase
      // ignora este campo e devolve sessão direto.
      emailRedirectTo: `${origin}/auth/confirm?next=/`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Auto-confirm (Confirm email OFF): sessão veio no signUp, segue pra home.
  if (data.session) {
    redirect('/');
  }
  // Confirm email ON: signUp retorna sem sessão; mostra tela "verifique seu email".
  redirect(`/cadastro/confirme-email?email=${encodeURIComponent(email)}`);
}

/**
 * Reenvia o email de confirmação de signup (usado pela tela /cadastro/confirme-email).
 *
 * **Limites de abuso**: como o user ainda não pode logar (acabou de tentar signup),
 * não dá pra exigir auth aqui. Defesa em camadas:
 *   - Supabase aplica rate limit interno em `auth.resend` (~60s por email/IP).
 *   - O cliente (ResendButton) também trava 30s entre cliques.
 *   - Em prod, recomendo configurar CAPTCHA no Supabase Auth pra esta rota.
 */
export async function resendConfirmacaoAction(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cleaned = email.trim();
  if (!cleaned) return { ok: false, error: 'E-mail ausente.' };
  const origin = getSiteUrl();
  const supabase = await createServerClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: cleaned,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/` },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
