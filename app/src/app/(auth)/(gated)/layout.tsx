// (gated): todas as páginas autenticadas EXCETO /aceite. Route group não muda as
// URLs — só o aninhamento de layouts. Os dois gates moraram no (auth)/layout até
// 2026-07-23, controlados pelo header x-pathname do middleware; isso quebrava em
// produção (o header não chegava nas navegações RSC → redirect /aceite→/aceite em
// loop e tela preta pós-login). Aqui o loop é impossível por construção: /aceite
// está fora deste layout. Ordem importa: aceite LGPD antes do onboarding — antes,
// o gate de onboarding expulsava o usuário de /aceite e ele nunca conseguia aceitar.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { documentosPendentes } from '@/lib/lgpd/pendencia-aceite';

export default async function GatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login'); // (auth)/layout já cobre; guarda extra barata

  // Gate de re-aceite (LGPD, Task 12): documento publicado sem aceite na versão
  // vigente → /aceite. `documentosPendentes` é no-op ([]) sem docs publicados.
  const pendentes = await documentosPendentes(user.id);
  if (pendentes.length > 0) redirect('/aceite');

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle(),
    supabase.from('role_types').select('type').eq('user_id', user.id).maybeSingle(),
  ]);

  // AdminBalu e contadores recém-cadastrados não têm empresa e não podem ficar
  // presos em /onboarding — AdminBalu não opera empresas; o contador precisa
  // chegar em /contador/cadastro (existe desde a Task 10).
  const normalizedRole = (
    (roleRow?.type as string | null) ?? (user.user_metadata?.type as string | null) ?? ''
  ).toLowerCase();
  const needsOnboarding = !profile?.current_company && !['adminbalu', 'contador'].includes(normalizedRole);
  if (needsOnboarding) redirect('/onboarding');

  return <>{children}</>;
}
