'use server';
// Honorários v2 — CRUD do escritório sobre a carteira. Todas as ações exigem
// escritório aprovado (getContabilidadeCtx) e escopam toda mutação por
// contabilidade_id (anti-IDOR) — mesmo padrão de contador/actions.ts.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { HonorarioV2Schema } from '@/types/zod';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Sessão válida + escritório aprovado, ou o erro pronto pra devolver da action. */
async function requireEscritorioAprovado(): Promise<{ id: string } | { ok: false; error: string }> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };
  if (g.contabilidade.status !== 'aprovada') return { ok: false, error: 'Escritório não aprovado.' };
  return { id: g.contabilidade.id };
}

/** Data de hoje em YYYY-MM-DD, ajustada para BRT (mesmo ajuste do legado honorarios/actions.ts). */
function hojeBR(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

export async function createHonorarioV2Action(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireEscritorioAprovado();
  if ('ok' in ctx) return ctx;

  const parsed = HonorarioV2Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const admin = createAdminClient();
  // Anti-IDOR: o cliente selecionado precisa pertencer à carteira deste escritório.
  const { data: empresa } = await admin
    .from('companies')
    .select('id')
    .eq('id', parsed.data.empresa_cliente_id)
    .eq('contabilidade_id', ctx.id)
    .maybeSingle();
  if (!empresa) return { ok: false, error: 'Cliente não pertence à sua carteira.' };

  const { data, error } = await admin
    .from('honorarios')
    .insert({
      contabilidade_id: ctx.id,
      empresa_cliente_id: parsed.data.empresa_cliente_id,
      company_id: parsed.data.empresa_cliente_id, // legado: company_id é NOT NULL no schema real
      mes_referencia: `${parsed.data.mes_referencia}-01`,
      valor: parsed.data.valor.replace(',', '.'),
      data_vencimento: parsed.data.data_vencimento,
      observacao: parsed.data.observacao || null,
      recorrente: parsed.data.recorrente,
      recorrencia_dia: parsed.data.recorrente ? parsed.data.recorrencia_dia : null,
      status: 'pendente',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar honorário.' };

  revalidatePath('/contador/honorarios');
  return { ok: true, data: { id: data.id } };
}

export async function updateHonorarioV2Action(id: string, input: unknown): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if ('ok' in ctx) return ctx;

  const parsed = HonorarioV2Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const admin = createAdminClient();
  const { data: empresa } = await admin
    .from('companies')
    .select('id')
    .eq('id', parsed.data.empresa_cliente_id)
    .eq('contabilidade_id', ctx.id)
    .maybeSingle();
  if (!empresa) return { ok: false, error: 'Cliente não pertence à sua carteira.' };

  const { error } = await admin
    .from('honorarios')
    .update({
      empresa_cliente_id: parsed.data.empresa_cliente_id,
      company_id: parsed.data.empresa_cliente_id,
      mes_referencia: `${parsed.data.mes_referencia}-01`,
      valor: parsed.data.valor.replace(',', '.'),
      data_vencimento: parsed.data.data_vencimento,
      observacao: parsed.data.observacao || null,
      recorrente: parsed.data.recorrente,
      recorrencia_dia: parsed.data.recorrente ? parsed.data.recorrencia_dia : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id); // escopado (anti-IDOR)
  if (error) return { ok: false, error: error.message };

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function marcarPagoV2Action(id: string, forma_pagamento: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if ('ok' in ctx) return ctx;

  const admin = createAdminClient();
  const { error } = await admin
    .from('honorarios')
    .update({
      data_pagamento: hojeBR(),
      status: 'pago',
      forma_pagamento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function desmarcarPagoV2Action(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if ('ok' in ctx) return ctx;

  const admin = createAdminClient();
  const { error } = await admin
    .from('honorarios')
    .update({
      data_pagamento: null,
      status: 'pendente',
      forma_pagamento: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function deleteHonorarioV2Action(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if ('ok' in ctx) return ctx;

  const admin = createAdminClient();
  const { error } = await admin
    .from('honorarios')
    .delete()
    .eq('id', id)
    .eq('contabilidade_id', ctx.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/contador/honorarios');
  return { ok: true };
}
