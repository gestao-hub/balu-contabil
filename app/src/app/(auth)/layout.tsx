// @custom — bubble-behavior: editado à mão, não regenerar.
// Auth gate: sem sessão → /login; sem empresa (current_company vazio) → /onboarding.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import MenuLateral from '@/components/MenuLateral';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: companies }, { data: roleRow }, { data: membro }] = await Promise.all([
    supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle(),
    supabase.from('companies').select('id, nome').eq('user_id', user.id).order('nome'),
    supabase.from('role_types').select('type').eq('user_id', user.id).maybeSingle(),
    supabase.from('contabilidade_membros').select('contabilidade_id').eq('user_id', user.id).maybeSingle(),
  ]);

  // role_types.type é a fonte canônica; metadata como fallback.
  const rawRole = (roleRow?.type as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
  const normalizedRole = rawRole.toLowerCase();
  const userRole: 'empresa' | 'contador' | 'adminbalu' =
    normalizedRole === 'contador' ? 'contador' : normalizedRole === 'adminbalu' ? 'adminbalu' : 'empresa';
  // AdminBalu e contadores recém-cadastrados não têm empresa e não podem ficar
  // presos em /onboarding — AdminBalu não opera empresas; o contador precisa
  // chegar em /contador/cadastro (existe desde a Task 10).
  const needsOnboarding = !profile?.current_company && !['adminbalu', 'contador'].includes(normalizedRole);
  if (needsOnboarding) redirect('/onboarding');

  // Layout SaaS: sidebar fixa no viewport, área principal com scroll próprio.
  // `h-screen overflow-hidden` no wrapper trava a página em 100vh; o `<main>`
  // de cada rota fica em um `overflow-y-auto` próprio, e o scrollbar aparece
  // ao lado do conteúdo (sem mover a sidebar).
  return (
    <div className="h-screen flex overflow-hidden">
      <MenuLateral
        userName={
          ((user.user_metadata?.full_name as string | null)?.trim()) ||
          user.email ||
          'Usuário'
        }
        userRole={userRole}
        companies={companies ?? []}
        currentCompanyId={profile?.current_company ?? null}
        temEscritorio={!!membro}
      />
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</div>
    </div>
  );
}
