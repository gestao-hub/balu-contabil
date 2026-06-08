// @custom — Lançamento manual de NF (registro de nota já emitida fora). Sem Focus.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import NotaManualForm from './NotaManualForm';
import type { ClienteOption } from '../emissao/ClienteCombobox';

export default async function NotaManualPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;

  const { data: clientesRaw } = companyId
    ? await supabase.from('clientes')
        .select('id, razao_social, document, person_type')
        .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
        .order('razao_social', { ascending: true }).limit(500)
    : { data: [] };

  const clientes: ClienteOption[] = (clientesRaw ?? []).map((c) => ({
    id: c.id as string,
    razao_social: (c.razao_social as string | null) ?? '—',
    document: (c.document as string | null) ?? '',
    person_type: (c.person_type as string | null) ?? 'PJ',
  }));

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <Link href="/notas_fiscais" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Lançar nota manual</h1>
        <p className="text-sm text-muted-foreground mt-1">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
      </header>
      <NotaManualForm clientes={clientes} />
    </main>
  );
}
