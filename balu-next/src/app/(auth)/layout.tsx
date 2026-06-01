// @custom — bubble-behavior: editado à mão, não regenerar.
// Auth gate: sem sessão → /login; sem empresa (current_company vazio) → /onboarding.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import MenuLateral from '@/components/MenuLateral';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: companies }] = await Promise.all([
    supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle(),
    supabase.from('companies').select('id, nome').eq('user_id', user.id).order('nome'),
  ]);

  // Papel do usuário vem do metadata do signup; profiles.user_role não existe no
  // banco real (o tipo é gravado em role_types, não exposto ao client).
  const userRole =
    String(user.user_metadata?.type ?? '').toLowerCase() === 'contador' ? 'contador' : 'empresa';
  const needsOnboarding = !profile?.current_company;
  if (needsOnboarding) redirect('/onboarding');

  // Layout SaaS: sidebar fixa no viewport, área principal com scroll próprio.
  // `h-screen overflow-hidden` no wrapper trava a página em 100vh; o `<main>`
  // de cada rota fica em um `overflow-y-auto` próprio, e o scrollbar aparece
  // ao lado do conteúdo (sem mover a sidebar).
  return (
    <div className="h-screen flex overflow-hidden">
      <MenuLateral
        userName={user.email ?? 'Usuário'}
        userRole={userRole}
        companies={companies ?? []}
        currentCompanyId={profile?.current_company ?? null}
      />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
