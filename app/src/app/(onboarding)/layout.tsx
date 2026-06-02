// src/app/(onboarding)/layout.tsx
// Layout do onboarding: exige login mas NÃO exige current_company (senão o gate
// do (auth) e este se chocariam). Sem MenuLateral — chrome mínimo, card centrado.
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      {children}
    </main>
  );
}
