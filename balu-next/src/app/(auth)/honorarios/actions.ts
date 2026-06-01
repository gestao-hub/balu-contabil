'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { HonorarioSchema } from '@/types/zod';

type Result = { ok: true } | { ok: false; error: string };

function mesReferenciaToDate(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01`;
}

async function getUserAndCompany() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, companyId: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company as string | null) ?? null;
  return { supabase, user, companyId };
}

function parseFormData(fd: FormData) {
  return {
    cliente_id:      fd.get('cliente_id'),
    company_id:      fd.get('company_id'),
    mes_referencia:  fd.get('mes_referencia'),
    valor:           Number(fd.get('valor')),
    data_vencimento: fd.get('data_vencimento'),
    observacao:      fd.get('observacao') || undefined,
  };
}

export async function createHonorarioAction(fd: FormData): Promise<Result> {
  const raw = parseFormData(fd);
  const parsed = HonorarioSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const { supabase, user } = await getUserAndCompany();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase.from('honorarios').insert({
    ...parsed.data,
    mes_referencia: mesReferenciaToDate(parsed.data.mes_referencia),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function updateHonorarioAction(id: string, fd: FormData): Promise<Result> {
  if (!id) return { ok: false, error: 'ID ausente.' };
  const raw = parseFormData(fd);
  const parsed = HonorarioSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const { supabase, user } = await getUserAndCompany();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .update({
      ...parsed.data,
      mes_referencia: mesReferenciaToDate(parsed.data.mes_referencia),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', parsed.data.company_id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function marcarPagoAction(id: string, companyId: string): Promise<Result> {
  if (!id || !companyId) return { ok: false, error: 'Parâmetros ausentes.' };

  const today = new Date();
  const brt = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const dataPagamento = brt.toISOString().slice(0, 10);

  const { supabase, user } = await getUserAndCompany();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .update({ status: 'pago', data_pagamento: dataPagamento, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}

export async function deleteHonorarioAction(id: string, companyId: string): Promise<Result> {
  if (!id || !companyId) return { ok: false, error: 'Parâmetros ausentes.' };

  const { supabase, user } = await getUserAndCompany();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('honorarios')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/honorarios');
  return { ok: true };
}
