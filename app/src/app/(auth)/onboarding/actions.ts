// @custom — bubble-behavior: Create_company (PRD §6.7)
// Server actions usadas pelo <CreateCompanyDialog>:
//  - lookupCepAction:   consulta ViaCEP e retorna endereço
//  - createCompanyAction: insere em `companies` + chama RPC add_company_to_profile
// A consulta de CNPJ na Focus vive em lib/fiscal/cnpj-lookup.ts e é reexportada
// aqui (empresa) e em clientes/actions.ts (cliente) como server action.
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { CompanyCreateSchema, type CompanyInput } from '@/types/zod';
import { syncEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import { sincronizarCnaesEmpresa } from '@/lib/fiscal/cnae-sync';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import { lookupCnpj } from '@/lib/fiscal/cnpj-lookup';
import { ibgePorCep } from '@/lib/fiscal/ibge-por-cep';

export async function lookupCnpjAction(cnpj: string) {
  return lookupCnpj(cnpj);
}

export type CepLookup = {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  ibge?: string; // código IBGE 7 díg → companies.codigo_municipio (exigido pela NFS-e)
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

export async function lookupCepAction(cep: string): Promise<ActionResult<{ data: CepLookup }>> {
  const d = normCep(cep);
  if (d.length !== 8) return { ok: false, error: 'CEP inválido.' };
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `ViaCEP retornou ${res.status}.` };
    const json = (await res.json()) as Record<string, unknown>;
    if (json['erro']) return { ok: false, error: 'CEP não encontrado.' };
    const ibge = stringOrUndef(json['ibge'])?.replace(/\D+/g, '');
    const data: CepLookup = {
      logradouro:  stringOrUndef(json['logradouro']),
      complemento: stringOrUndef(json['complemento']),
      bairro:      stringOrUndef(json['bairro']),
      municipio:   stringOrUndef(json['localidade']),
      uf:          stringOrUndef(json['uf']),
      ibge:        ibge && ibge.length === 7 ? ibge : undefined,
    };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao consultar CEP.' };
  }
}

export async function createCompanyAction(input: CompanyInput): Promise<ActionResult<{ id: string }>> {
  const parsed = CompanyCreateSchema.safeParse({ ...input, cnpj: normCnpj(input?.cnpj ?? '') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  // Code_regime_tributario e cnae_principal moram em empresas_fiscais, não em companies —
  // separa antes do insert pra não tentar gravar coluna inexistente.
  const { Code_regime_tributario, cnae_principal, ...companyFields } = parsed.data;

  // codigo_municipio (IBGE) não vem da Focus (/v2/cnpjs) e o autofill por CNPJ deixa
  // o campo vazio — sem ele a NFS-e trava ("Município sem código IBGE"). Resolve pelo
  // CEP (ViaCEP) quando vier vazio. Best-effort: se não resolver, segue como antes.
  let codigoMunicipio = companyFields.codigo_municipio?.trim() || '';
  if (!codigoMunicipio && companyFields.cep) {
    codigoMunicipio = (await ibgePorCep(companyFields.cep)) ?? '';
  }

  const payload = {
    ...companyFields,
    codigo_municipio: codigoMunicipio || null,
    user_id: user.id,
    nome: companyFields.nome?.trim() || companyFields.razao_social,
  };

  const { data: row, error } = await supabase
    .from('companies')
    .insert(payload)
    .select('id')
    .single();

  if (error || !row) {
    return { ok: false, error: error?.message ?? 'Falha ao criar empresa.' };
  }

  // Vem de `/r/[token]` (link reutilizável do escritório): cookie httpOnly com o
  // token setado na redenção do link. A RPC valida tudo (token, escritório ativo,
  // empresa sem contabilidade ainda) — falha aqui NÃO derruba a criação da empresa,
  // ela só fica sem vínculo (usuário pode vincular depois).
  const cookieStore = await cookies();
  const refToken = cookieStore.get('balu_ref_convite')?.value;
  if (refToken) {
    const { error: vincErr } = await supabase.rpc('vincular_empresa_por_link', {
      p_token: refToken,
      p_company_id: row.id,
    });
    if (vincErr) {
      console.warn('[createCompany] vincular_empresa_por_link falhou:', vincErr.message);
    }
    cookieStore.delete('balu_ref_convite');
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

  // empresas_fiscais: insere com regime + owner. Falha aqui não rejeita a empresa
  // (usuário pode reconfigurar depois na aba Regime tributário).
  const fiscalPatch = normalizeRegimePatch({ Code_regime_tributario });
  const { error: fiscalErr } = await supabase.from('empresas_fiscais').insert({
    empresa_id: row.id,
    owner_user_id: user.id,
    cnpj: companyFields.cnpj,
    cnae_principal: cnae_principal ?? null,
    ...fiscalPatch,
  });
  if (fiscalErr) {
    // Loga e segue — não bloqueia o cadastro.
    console.warn('[createCompany] empresas_fiscais insert falhou:', fiscalErr.message);
  }

  // POST best-effort na Focus. Falha NÃO bloqueia o cadastro: resultado fica
  // em companies.focus_status + focus_last_error, exibido no painel "Saúde da
  // empresa" (Focus 3) com botão de retry.
  const sync = await syncEmpresaNaFocus(supabase, row.id);
  if (!sync.ok) {
    console.warn('[createCompany] Focus POST falhou:', sync.error);
  }

  // Popula company_cnaes (principal + secundários) — best-effort, não derruba o cadastro.
  await sincronizarCnaesEmpresa(supabase, {
    companyId: row.id,
    ownerUserId: user.id,
    cnpj: companyFields.cnpj ?? '',
    cnaePrincipalFallback: cnae_principal ?? null,
  });

  revalidatePath('/');
  return { ok: true, id: row.id };
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
