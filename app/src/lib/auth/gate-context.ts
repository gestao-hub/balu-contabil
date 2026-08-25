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

  // `role_types.type` é a ÚNICA fonte. Não há fallback para `user_metadata` —
  // aquele objeto é gravável pelo próprio dono da sessão (GoTrue
  // `PUT /auth/v1/user`, com a anon key), então um papel lido de lá é um papel
  // escolhido pelo usuário. O fallback só disparava quando faltava a linha em
  // `role_types`, e a policy de DELETE daquela tabela deixava o usuário apagar
  // a própria (auditoria 25/08; a 0104 fechou a policy, isto fecha a leitura).
  //
  // Medido antes de remover: 8 contas, 8 linhas em `role_types`, ZERO órfãs —
  // ninguém dependia do fallback. E 3 contas já tinham `metadata` divergindo
  // do papel real (uma `AdminBalu` com `metadata=Empresa`), o que mostra que
  // aquele valor era resíduo de cadastro, não fonte.
  const rawRole = (roleRow?.type as string | null) ?? '';
  return {
    user,
    currentCompany: (profile?.current_company as string | null) ?? null,
    rawRole,
    normalizedRole: rawRole.toLowerCase(),
  };
});
