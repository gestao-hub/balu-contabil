'use server';

// @custom — bubble-behavior
// Server actions do CRUD de clientes (PRD §9 + §6.4-6.6).

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { lookupCnpj, type CnpjLookup } from '@/lib/fiscal/cnpj-lookup';
import { ClienteSchema, type ClienteInput } from '@/types/zod';
import { assertAssinaturaEmpresa } from '@/lib/billing/gate';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export type { CnpjLookup };

type Ctx =
  | { error: string }
  | { supabase: Awaited<ReturnType<typeof createServerClient>>; userId: string; companyId: string };

async function getContext(): Promise<Ctx> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { error: 'Nenhuma empresa selecionada.' };
  return { supabase, userId: user.id, companyId };
}

export async function createClienteAction(input: ClienteInput): Promise<ActionResult<{ id: string }>> {
  const parsed = ClienteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const ctx = await getContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const assinatura = await assertAssinaturaEmpresa(ctx.companyId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  const { supabase, userId, companyId } = ctx;

  // Dedup por (owner_user_id, document) — PRD §6.4.
  const { data: dup } = await supabase
    .from('clientes')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('document', parsed.data.document)
    .is('deleted_at', null)
    .maybeSingle();
  if (dup) return { ok: false, error: 'Você já possui um cliente com esse cpf/cnpj cadastrado!' };

  const { data, error } = await supabase
    .from('clientes')
    .insert({
      ...parsed.data,
      owner_user_id: userId,
      company_id: companyId,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath('/clientes');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateClienteAction(id: string, input: ClienteInput): Promise<ActionResult> {
  const parsed = ClienteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const ctx = await getContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const assinatura = await assertAssinaturaEmpresa(ctx.companyId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  const { supabase, userId } = ctx;

  // `undefined` VIRA `null` AQUI, e isso não é detalhe.
  //
  // Campo opcional apagado no formulário chega como `''` e o schema o converte
  // para `undefined` (ver `opcionalDeFormulario` em `types/zod.ts`). No INSERT
  // isso é o certo — chave ausente vira NULL. No UPDATE é o oposto:
  // `JSON.stringify` DESCARTA chaves com `undefined`, então a coluna some do
  // PATCH e o PostgREST simplesmente não a toca. O usuário apagava o e-mail,
  // salvava, via "Cliente atualizado!" — e o valor antigo continuava no banco,
  // reaparecendo no próximo carregamento. Falha silenciosa, com toast de
  // sucesso. Mapeando para `null`, apagar volta a apagar.
  const paraGravar = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [k, v === undefined ? null : v]),
  );

  const { data, error } = await supabase
    .from('clientes')
    .update({ ...paraGravar, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', userId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Cliente não encontrado.' };
  revalidatePath('/clientes');
  return { ok: true };
}

export async function softDeleteClienteAction(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const assinatura = await assertAssinaturaEmpresa(ctx.companyId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  const { supabase, userId } = ctx;

  const { data, error } = await supabase
    .from('clientes')
    .update({ status: 'inactive', deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', userId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Cliente não encontrado.' };
  revalidatePath('/clientes');
  return { ok: true };
}

export async function lookupCnpjAction(cnpj: string) {
  return lookupCnpj(cnpj);
}
