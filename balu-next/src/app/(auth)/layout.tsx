// @custom — bubble-behavior: editado à mão, não regenerar.
// Onboarding: se profile.current_company estiver vazio, força o <CreateCompanyDialog>.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import MenuLateral from '@/components/MenuLateral';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: companies }] = await Promise.all([
    supabase.from('profiles').select('current_company, user_role').eq('id', user.id).single(),
    supabase.from('companies').select('id, nome').eq('user_id', user.id).order('nome'),
  ]);

  const needsOnboarding = !profile?.current_company;

  return (
    <div className="min-h-screen flex">
      <MenuLateral
        userName={user.email ?? 'Usuário'}
        userRole={(profile?.user_role as 'empresa' | 'contador') ?? 'empresa'}
        companies={companies ?? []}
        currentCompanyId={profile?.current_company ?? null}
      />
      <div className="flex-1">{children}</div>
      {needsOnboarding && (
        <CreateCompanyDialog open={true} forceCreate={true} />
      )}
    </div>
  );
}
