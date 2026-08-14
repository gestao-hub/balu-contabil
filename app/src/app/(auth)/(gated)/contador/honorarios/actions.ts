'use server';
// Honorários v2 — CRUD do escritório sobre a carteira. Todas as ações exigem
// escritório aprovado (getContabilidadeCtx) e escopam toda mutação por
// contabilidade_id (anti-IDOR) — mesmo padrão de contador/actions.ts.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { HonorarioV2Schema } from '@/types/zod';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * ─── ZERO LINHAS AFETADAS NÃO É SUCESSO ─────────────────────────────────────
 *
 * O `.eq('contabilidade_id', ctx.id)` de cada mutação aqui sempre impediu o
 * dano — honorário de outro escritório nunca foi tocado. Mas UPDATE/DELETE que
 * não casa nada NÃO é erro no PostgREST: `error` volta null, e as quatro ações
 * liam isso como sucesso — gravavam auditoria e devolviam `ok: true`.
 *
 * Achado em 14/08/2026 pelo teste ponta a ponta (`tests/idor-actions-contador.spec.ts`),
 * chamando `marcarPagoV2Action` com o id de um honorário de OUTRO escritório: o
 * valor ficou intacto, e mesmo assim nasceu em `audit_log` um `honorario.pagar`
 * dizendo que este contador quitou aquele honorário. Qualquer contador
 * autenticado podia carimbar o audit_log com o UUID que quisesse.
 *
 * Nada disso apareceu nos testes de RLS, e não apareceria: estas ações usam
 * `createAdminClient()`, que ignora RLS por definição.
 *
 * A mensagem é a mesma para "não existe" e "é de outro escritório", de
 * propósito — a diferença entre as duas é justamente o que não se deve contar.
 */
const NAO_E_SEU = 'Honorário não encontrado na sua carteira.';

/** Data de hoje em YYYY-MM-DD, ajustada para BRT (mesmo ajuste do legado honorarios/actions.ts). */
function hojeBR(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

export async function createHonorarioV2Action(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

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
      valor: parsed.data.valor, // já normalizado a ponto-decimal por HonorarioV2Schema
      data_vencimento: parsed.data.data_vencimento,
      observacao: parsed.data.observacao || null,
      recorrente: parsed.data.recorrente,
      recorrencia_dia: parsed.data.recorrente ? parsed.data.recorrencia_dia : null,
      status: 'pendente',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar honorário.' };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'honorario.criar',
    alvoTipo: 'honorario', alvoId: data.id, contabilidadeId: ctx.id,
  });

  revalidatePath('/contador/honorarios');
  return { ok: true, data: { id: data.id } };
}

export async function updateHonorarioV2Action(id: string, input: unknown): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

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

  const { data: afetadas, error } = await admin
    .from('honorarios')
    .update({
      empresa_cliente_id: parsed.data.empresa_cliente_id,
      company_id: parsed.data.empresa_cliente_id,
      mes_referencia: `${parsed.data.mes_referencia}-01`,
      valor: parsed.data.valor, // já normalizado a ponto-decimal por HonorarioV2Schema
      data_vencimento: parsed.data.data_vencimento,
      observacao: parsed.data.observacao || null,
      recorrente: parsed.data.recorrente,
      recorrencia_dia: parsed.data.recorrente ? parsed.data.recorrencia_dia : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id) // escopado (anti-IDOR)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!afetadas || afetadas.length === 0) return { ok: false, error: NAO_E_SEU };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'honorario.editar',
    alvoTipo: 'honorario', alvoId: id, contabilidadeId: ctx.id,
  });

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function marcarPagoV2Action(id: string, forma_pagamento: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

  const admin = createAdminClient();
  const { data: afetadas, error } = await admin
    .from('honorarios')
    .update({
      data_pagamento: hojeBR(),
      status: 'pago',
      forma_pagamento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!afetadas || afetadas.length === 0) return { ok: false, error: NAO_E_SEU };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'honorario.pagar',
    alvoTipo: 'honorario', alvoId: id, contabilidadeId: ctx.id,
  });

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function desmarcarPagoV2Action(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

  const admin = createAdminClient();
  const { data: afetadas, error } = await admin
    .from('honorarios')
    .update({
      data_pagamento: null,
      status: 'pendente',
      forma_pagamento: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('contabilidade_id', ctx.id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!afetadas || afetadas.length === 0) return { ok: false, error: NAO_E_SEU };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'honorario.despagar',
    alvoTipo: 'honorario', alvoId: id, contabilidadeId: ctx.id,
  });

  revalidatePath('/contador/honorarios');
  return { ok: true };
}

export async function deleteHonorarioV2Action(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

  const admin = createAdminClient();
  const { data: afetadas, error } = await admin
    .from('honorarios')
    .delete()
    .eq('id', id)
    .eq('contabilidade_id', ctx.id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!afetadas || afetadas.length === 0) return { ok: false, error: NAO_E_SEU };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'honorario.excluir',
    alvoTipo: 'honorario', alvoId: id, contabilidadeId: ctx.id,
  });

  revalidatePath('/contador/honorarios');
  return { ok: true };
}
