'use server';
// @custom — PR 3.1 — Dashboard de Impostos
// Server actions ligadas ao histórico de guias.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

export type GuiaActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marca uma guia como paga (PATCH status='paga' + data_pagamento=hoje).
 * Idempotente: clicar de novo não desfaz; pra "desmarcar" um dia exporemos
 * uma action separada (não pedida no PR 3.1).
 *
 * Valida ownership por `company_id == profile.current_company`.
 */
export async function marcarGuiaPagaAction(id: string): Promise<GuiaActionResult> {
  if (!id) return { ok: false, error: 'ID da guia ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // YYYY-MM-DD no fuso de Brasília.
  const today = new Date();
  const brt = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const dataPagamento = brt.toISOString().slice(0, 10);

  const { error } = await supabase
    .from('guias_fiscais')
    .update({
      status: 'paga',
      data_pagamento: dataPagamento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/impostos');
  return { ok: true };
}
