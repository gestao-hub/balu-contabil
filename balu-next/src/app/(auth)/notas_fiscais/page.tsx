// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
import { createServerClient } from '@/lib/supabase/server';
import NotasFiscaisList, { type NotaListRow } from './NotasFiscaisList';

export default async function NotasFiscaisPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let notas: NotaListRow[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_company')
      .eq('id', user.id)
      .single();
    const companyId = (profile?.current_company ?? null) as string | null;

    if (companyId) {
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, tipo_documento, referencia, data_emissao, valor_total, status, payload_focusnfe')
        .eq('company_id', companyId)
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(50);

      type NotaRaw = Omit<NotaListRow, 'cliente_nome'> & {
        payload_focusnfe: { destinatario?: { razao_social?: string | null } | null } | null;
      };
      notas = ((data ?? []) as unknown as NotaRaw[]).map(({ payload_focusnfe, ...n }) => ({
        ...n,
        cliente_nome: payload_focusnfe?.destinatario?.razao_social ?? null,
      }));
    }
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-navy">Notas fiscais</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Histórico das notas emitidas pela empresa selecionada.
        </p>
      </header>

      <NotasFiscaisList initial={notas} />
    </main>
  );
}
