// @custom — bubble-behavior: Create_company (PRD §6.7)
// Server actions usadas pelo <CreateCompanyDialog>:
//  - lookupCnpjAction:  consulta Focus NFe (server-only) e retorna dados pré-preenchimento
//  - lookupCepAction:   consulta ViaCEP e retorna endereço
//  - createCompanyAction: insere em `companies` + chama RPC add_company_to_profile
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { focus } from '@/lib/clients/focus-nfe';
import { CompanySchema, type CompanyInput } from '@/types/zod';

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

export type CepLookup = {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
};

type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D+/g, '');
}

function normCnpj(s: string): string {
  return onlyDigits(s).padStart(14, '0').slice(-14);
}

function normCep(s: string): string {
  return onlyDigits(s).slice(0, 8);
}

export async function lookupCnpjAction(cnpj: string): Promise<ActionResult<{ data: CnpjLookup }>> {
  const d = normCnpj(cnpj);
  if (d.length !== 14 || /^0+$/.test(d)) {
    return { ok: false, error: 'CNPJ inválido.' };
  }
  try {
    const env = (process.env.FOCUS_NFE_ENV === 'prod' ? 'prod' : 'hom') as 'prod' | 'hom';
    const raw = await focus.consultarCnpj(d, env);
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

export async function lookupCepAction(cep: string): Promise<ActionResult<{ data: CepLookup }>> {
  const d = normCep(cep);
  if (d.length !== 8) return { ok: false, error: 'CEP inválido.' };
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `ViaCEP retornou ${res.status}.` };
    const json = (await res.json()) as Record<string, unknown>;
    if (json['erro']) return { ok: false, error: 'CEP não encontrado.' };
    const data: CepLookup = {
      logradouro:  stringOrUndef(json['logradouro']),
      complemento: stringOrUndef(json['complemento']),
      bairro:      stringOrUndef(json['bairro']),
      municipio:   stringOrUndef(json['localidade']),
      uf:          stringOrUndef(json['uf']),
    };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao consultar CEP.' };
  }
}

export async function createCompanyAction(input: CompanyInput): Promise<ActionResult<{ id: string }>> {
  const parsed = CompanySchema.safeParse({ ...input, cnpj: normCnpj(input?.cnpj ?? '') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  // `companies` não tem coluna `status` no banco real — não enviar.
  const payload = {
    ...parsed.data,
    user_id: user.id,
    nome: parsed.data.nome?.trim() || parsed.data.razao_social,
  };

  const { data: row, error } = await supabase
    .from('companies')
    .insert(payload)
    .select('id')
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message ?? 'Falha ao criar empresa.' };
  }

  // Vincula a empresa ao perfil e define como atual. Não usamos o RPC
  // add_company_to_profile: no banco ele escreve em company_id (não current_company)
  // e assume um profile pré-existente — mas o trigger que criava profiles no signup
  // não existe. Fazemos o upsert manual por user_id.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  const { error: profErr } = existingProfile
    ? await supabase.from('profiles').update({ current_company: row.id }).eq('user_id', user.id)
    : await supabase.from('profiles').insert({ user_id: user.id, current_company: row.id });
  if (profErr) return { ok: false, error: profErr.message };

  revalidatePath('/');
  return { ok: true, id: row.id };
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
