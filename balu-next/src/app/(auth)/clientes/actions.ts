'use server';

// @custom — bubble-behavior
// Server actions do CRUD de clientes (PRD §9 + §6.4-6.6).

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { focus } from '@/lib/clients/focus-nfe';
import { ClienteSchema, type ClienteInput } from '@/types/zod';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export type CnpjLookup = {
  razao_social?: string;
  nome_fantasia?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
};

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
  const { supabase } = ctx;

  const { error } = await supabase
    .from('clientes')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/clientes');
  return { ok: true };
}

export async function softDeleteClienteAction(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { supabase } = ctx;

  const { error } = await supabase
    .from('clientes')
    .update({ status: 'inactive', deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/clientes');
  return { ok: true };
}

// Consulta de CNPJ na Focus para pré-preencher o cadastro de CLIENTE (PJ).
// (No cadastro de empresa essa busca foi removida — só cliente usa.)
function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D+/g, '');
}
function normCnpj(s: string): string {
  return onlyDigits(s).padStart(14, '0').slice(-14);
}
function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

export async function lookupCnpjAction(cnpj: string): Promise<ActionResult<CnpjLookup>> {
  const d = normCnpj(cnpj);
  if (d.length !== 14 || /^0+$/.test(d)) return { ok: false, error: 'CNPJ inválido.' };
  try {
    // A consulta /v2/cnpjs só existe em PRODUÇÃO na Focus (404 em homologação).
    // É read-only da Receita, então forçamos 'prod' independente de FOCUS_NFE_ENV.
    const raw = await focus.consultarCnpj(d, 'prod');
    const data: CnpjLookup = {
      razao_social:   stringOrUndef(raw['razao_social'] ?? raw['nome']),
      nome_fantasia:  stringOrUndef(raw['nome_fantasia'] ?? raw['fantasia']),
      logradouro:     stringOrUndef(raw['logradouro']),
      numero:         stringOrUndef(raw['numero']),
      complemento:    stringOrUndef(raw['complemento']),
      bairro:         stringOrUndef(raw['bairro']),
      municipio:      stringOrUndef(raw['municipio']),
      uf:             stringOrUndef(raw['uf']),
      cep:            stringOrUndef(raw['cep'])?.replace(/\D+/g, ''),
      telefone:       stringOrUndef(raw['telefone']),
      email:          stringOrUndef(raw['email']),
    };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao consultar CNPJ.' };
  }
}
