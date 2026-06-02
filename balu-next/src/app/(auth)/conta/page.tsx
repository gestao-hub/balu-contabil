// src/app/(auth)/conta/page.tsx
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import PerfilForm from './PerfilForm';
import AlterarSenhaForm from './AlterarSenhaForm';
import DangerZone from './DangerZone';

const TABS = [
  { key: 'perfil',    label: 'Perfil' },
  { key: 'seguranca', label: 'Segurança' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type SP = Promise<{ tab?: string }>;

export default async function ContaPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const active: TabKey =
    (TABS.find((t) => t.key === sp.tab)?.key ?? 'perfil') as TabKey;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: roleRow } = await supabase
    .from('role_types')
    .select('type')
    .eq('user_id', user.id)
    .maybeSingle();

  const nome = (user.user_metadata?.full_name as string | null) ?? '';
  const email = user.email ?? '';
  const role = (roleRow?.type as string | null) ?? 'Empresa';

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Minha conta</h1>
        <p className="text-sm text-muted-foreground mt-1">{email}</p>
      </header>

      <nav className="border-b border-border mb-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const is = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={`/conta?tab=${t.key}`}
                  className={`inline-block px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    is
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground-2 hover:text-foreground'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {active === 'perfil' && (
        <PerfilForm initialNome={nome} email={email} role={role} />
      )}

      {active === 'seguranca' && (
        <div className="space-y-8">
          <AlterarSenhaForm />
          <DangerZone email={email} />
        </div>
      )}
    </main>
  );
}
