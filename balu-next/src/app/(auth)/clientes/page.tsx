// @custom — bubble-behavior
// Página de listagem de clientes (PRD §9).

import { createServerClient } from '@/lib/supabase/server';
import ClientesListClient, { type Cliente } from '@/components/ClientesListClient';

export default async function ClientesPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let clientes: Cliente[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_company')
      .eq('id', user.id)
      .single();
    const currentCompanyId = profile?.current_company as string | null;

    if (currentCompanyId) {
      const { data } = await supabase
        .from('clientes')
        .select('*')
        .eq('company_id', currentCompanyId)
        .is('deleted_at', null)
        .order('razao_social');
      clientes = (data ?? []) as Cliente[];
    }
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-navy">Clientes</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Gerencie os clientes da empresa selecionada.
        </p>
      </header>

      <ClientesListClient initial={clientes} />
    </main>
  );
}
