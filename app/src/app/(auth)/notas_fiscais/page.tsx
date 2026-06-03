// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
import { createServerClient } from '@/lib/supabase/server';
import NotasFiscaisList, { type NotaListRow } from './NotasFiscaisList';
import { calcularLimiteEmissao, type LimiteEmissao } from '@/lib/fiscal/limite-emissao';
import { somarEmitidoNoAno } from '@/lib/fiscal/emitido-ano';
import LimiteEmissaoBanner from './LimiteEmissaoBanner';

export default async function NotasFiscaisPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let notas: NotaListRow[] = [];
  let limite: LimiteEmissao = { mostrar: false };
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_company')
      .eq('user_id', user.id)
      .single();
    const companyId = (profile?.current_company ?? null) as string | null;

    if (companyId) {
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, tipo_documento, referencia, data_emissao, valor_total, status, cliente_id, payload_focusnfe')
        .eq('company_id', companyId)
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(2000);

      type NotaRaw = Omit<NotaListRow, 'cliente_nome'> & {
        cliente_id: string | null;
        payload_focusnfe: { destinatario?: { razao_social?: string | null } | null } | null;
      };
      const rows = (data ?? []) as unknown as NotaRaw[];

      // Resolve nome do cliente: notas novas (PR 2.1+) usam cliente_id; notas
      // legadas (Bubble) caem no fallback payload_focusnfe.destinatario.razao_social.
      const ids = Array.from(new Set(rows.map((r) => r.cliente_id).filter((id): id is string => !!id)));
      const nomePorId: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: clientes } = await supabase
          .from('clientes')
          .select('id, razao_social')
          .in('id', ids);
        for (const c of clientes ?? []) {
          nomePorId[c.id as string] = (c.razao_social as string | null) ?? '';
        }
      }

      notas = rows.map(({ payload_focusnfe, cliente_id, ...n }) => ({
        ...n,
        cliente_nome:
          (cliente_id && nomePorId[cliente_id]) ||
          payload_focusnfe?.destinatario?.razao_social ||
          null,
      }));
      const { data: fiscal } = await supabase
        .from('empresas_fiscais')
        .select('Code_regime_tributario')
        .eq('empresa_id', companyId)
        .is('deleted_at', null)
        .maybeSingle();
      const ano = new Date(Date.now() - 3 * 60 * 60 * 1000).getFullYear(); // BRT
      const totalAno = await somarEmitidoNoAno(supabase, companyId, ano);
      limite = calcularLimiteEmissao(
        (fiscal?.Code_regime_tributario as string | null) ?? null,
        totalAno,
        ano,
      );
    }
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Notas fiscais</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico das notas emitidas pela empresa selecionada.
        </p>
      </header>

      <LimiteEmissaoBanner limite={limite} />
      <NotasFiscaisList initial={notas} />
    </main>
  );
}
