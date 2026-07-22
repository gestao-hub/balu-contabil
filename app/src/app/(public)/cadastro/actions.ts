// @custom — implementado pela skill bubble-behavior
'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteUrl } from '@/lib/site-url';
import { safeNext } from '@/lib/format/safe-next';
import { limitar, ipDe } from '@/lib/security/rate-limit';

export type SignupState = { error?: string } | undefined;

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const full_name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const password_confirm = String(formData.get('password_confirm') ?? '');
  const role_type = String(formData.get('role_type') ?? '').trim();
  const terms = formData.get('terms');
  const next = String(formData.get('next') ?? '');

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

  const ip = ipDe(await headers());
  if (!(await limitar(`signup:${ip}`, 5, 3600))) {
    return { error: 'Muitas tentativas. Tente novamente mais tarde.' };
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

  // Registra o aceite de cada documento (termos/privacidade) atualmente publicado,
  // na versão vigente no momento do cadastro. Usa admin client pois a sessão pode
  // ainda não existir (Confirm email ON). Sem docs publicados, não insere nada.
  if (data.user) {
    await registrarAceitesIniciais(data.user.id, ip);
  }

  // Auto-confirm (Confirm email OFF): sessão veio no signUp, segue pra `next`
  // (ex.: `/convite/<token>` — usuário veio de um convite deslogado) ou pra home.
  if (data.session) {
    redirect(safeNext(next) ?? '/');
  }
  // Confirm email ON: signUp retorna sem sessão; mostra tela "verifique seu email".
  // O retorno via link do email já é `next=/` fixo (emailRedirectTo acima) — não
  // dá pra propagar o `next` do form por esse caminho sem alterar o template do
  // Supabase, então mantemos o comportamento atual aqui (usuário resolve o
  // convite manualmente após confirmar, se for o caso).
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

/** Grava em `aceites` a versão vigente de cada documento LGPD publicado (termos/
 *  privacidade) no momento do cadastro. Usa admin client (bypassa RLS) porque no
 *  fluxo com "Confirm email" ligado ainda não há sessão para o usuário recém-criado.
 *  Sem documentos publicados, não insere nada (no-op silencioso). */
async function registrarAceitesIniciais(userId: string, ip: string): Promise<void> {
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from('documento_versoes')
    .select('tipo, versao, publicado_em')
    .not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });

  const vigentes = new Map<string, string>();
  for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao);
  if (vigentes.size === 0) return;

  const rows = [...vigentes].map(([tipo, versao]) => ({ user_id: userId, tipo, versao, ip }));
  await admin.from('aceites').insert(rows);
}
