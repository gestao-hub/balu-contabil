// (gated): todas as páginas autenticadas EXCETO /aceite. Route group não muda as
// URLs — só o aninhamento de layouts. Os dois gates moraram no (auth)/layout até
// 2026-07-23, controlados pelo header x-pathname do middleware; isso quebrava em
// produção (o header não chegava nas navegações RSC → redirect /aceite→/aceite em
// loop e tela preta pós-login). Aqui o loop é impossível por construção: /aceite
// está fora deste layout. Ordem importa: aceite LGPD antes do onboarding — antes,
// o gate de onboarding expulsava o usuário de /aceite e ele nunca conseguia aceitar.
import { redirect } from 'next/navigation';
import { getGateContext } from '@/lib/auth/gate-context';
import { documentosPendentes } from '@/lib/lgpd/pendencia-aceite';

export default async function GatedLayout({ children }: { children: React.ReactNode }) {
  // Mesmo helper memoizado do (auth)/layout: user + role + current_company sem
  // refazer getUser/profiles/role_types (cache() dedupa dentro do request).
  const ctx = await getGateContext();
  if (!ctx) redirect('/login'); // (auth)/layout já cobre; guarda extra barata
  const { user, currentCompany, normalizedRole } = ctx;

  // Gate de re-aceite (LGPD, Task 12): documento publicado sem aceite na versão
  // vigente → /aceite. `documentosPendentes` é no-op ([]) sem docs publicados.
  const pendentes = await documentosPendentes(user.id);
  if (pendentes.length > 0) redirect('/aceite');

  // AdminBalu e contadores recém-cadastrados não têm empresa e não podem ficar
  // presos em /onboarding — AdminBalu não opera empresas; o contador precisa
  // chegar em /contador/cadastro (existe desde a Task 10).
  const needsOnboarding = !currentCompany && !['adminbalu', 'contador'].includes(normalizedRole);
  if (needsOnboarding) redirect('/onboarding');

  return <>{children}</>;
}
