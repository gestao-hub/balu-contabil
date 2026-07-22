// src/app/(auth)/admin/contabilidades/page.tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/types/database';
import AprovacaoList from './AprovacaoList';

export type Contabilidade = Tables['contabilidades'];

export default async function AdminContabilidadesPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // role_types.type é a fonte canônica (igual ao layout/honorarios).
  const { data: roleRow } = await supabase
    .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
  if (roleRow?.type !== 'AdminBalu') redirect('/');

  // Lista via admin client (bypassa RLS) — pendentes primeiro (fila de espera,
  // mais antigas primeiro), depois as demais por created_at desc.
  const admin = createAdminClient();
  const [{ data: pendentes }, { data: outras }] = await Promise.all([
    admin.from('contabilidades').select('*').eq('status', 'pendente').order('created_at', { ascending: true }),
    admin.from('contabilidades').select('*').neq('status', 'pendente').order('created_at', { ascending: false }),
  ]);
  const contabilidades = [...(pendentes ?? []), ...(outras ?? [])] as Contabilidade[];

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Escritórios</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aprove ou recuse o cadastro de escritórios de contabilidade no Balu.
        </p>
      </header>

      <AprovacaoList initial={contabilidades} />
    </main>
  );
}
