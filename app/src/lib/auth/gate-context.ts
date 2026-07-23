// @custom — Contexto de gate de autenticação, memoizado por request (React cache).
// O (auth)/layout (sidebar + gate de login) e o (auth)/(gated)/layout (gates de
// aceite LGPD e onboarding) renderizam no MESMO request e ambos precisam de
// user + role + current_company. Sem esta memoização, cada navegação numa página
// gated fazia getUser() (round-trip ao Auth server) + profiles + role_types DUAS
// vezes. cache() dedupa dentro do request → uma ida só.
//
// De propósito NÃO faz redirect aqui: o gate mora em cada layout (parent → /login;
// gated → /aceite e /onboarding) para não ficar escondido num helper. Retorna null
// quando não há sessão — cada layout decide o que fazer.
import 'server-only';
import { cache } from 'react';
import { createServerClient } from '@/lib/supabase/server';

export const getGateContext = cache(async () => {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle(),
    supabase.from('role_types').select('type').eq('user_id', user.id).maybeSingle(),
  ]);

  // role_types.type é a fonte canônica; user_metadata como fallback.
  const rawRole = (roleRow?.type as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
  return {
    user,
    currentCompany: (profile?.current_company as string | null) ?? null,
    rawRole,
    normalizedRole: rawRole.toLowerCase(),
  };
});
