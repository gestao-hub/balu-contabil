// @custom — bubble-behavior: Create_company (PRD §6.7)
// Server actions usadas pelo <CreateCompanyDialog>:
//  - lookupCepAction:   consulta ViaCEP e retorna endereço
//  - createCompanyAction: insere em `companies` + chama RPC add_company_to_profile
// A consulta de CNPJ na Focus saiu daqui: agora só o cadastro de CLIENTE a usa
// (ver lookupCnpjAction em app/(auth)/clientes/actions.ts).
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { CompanyCreateSchema, type CompanyInput } from '@/types/zod';
import { focus } from '@/lib/clients/focus-nfe';
import { buildFocusEmpresaPayload } from '@/lib/fiscal/focus-empresa-payload';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';

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
  const parsed = CompanyCreateSchema.safeParse({ ...input, cnpj: normCnpj(input?.cnpj ?? '') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  // Code_regime_tributario mora em empresas_fiscais, não em companies — separa
  // antes do insert pra não tentar gravar coluna inexistente.
  const { Code_regime_tributario, ...companyFields } = parsed.data;

  const payload = {
    ...companyFields,
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
    ...fiscalPatch,
  });
  if (fiscalErr) {
    // Loga e segue — não bloqueia o cadastro.
    console.warn('[createCompany] empresas_fiscais insert falhou:', fiscalErr.message);
  }

  // POST best-effort na Focus (homologação). Falha NÃO bloqueia o cadastro:
  // resultado fica em companies.focus_status + focus_last_error, exibido no
  // painel "Saúde da empresa" (Focus 3) com botão de retry.
  await cadastrarEmpresaNaFocus(supabase, row.id, companyFields, Code_regime_tributario);

  revalidatePath('/');
  return { ok: true, id: row.id };
}

/**
 * Best-effort: monta payload, chama POST /v2/empresas em homologação, persiste
 * token+status em companies. Toda falha é capturada e gravada como `focus_status='erro'`
 * — nunca lança pra fora. Caller deve seguir o fluxo independente do resultado.
 */
type CompanyFieldsForFocus = Omit<CompanyInput, 'Code_regime_tributario'> & {
  cnpj: string; // já normalizado (14 dígitos)
};

async function cadastrarEmpresaNaFocus(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  companyId: string,
  companyFields: CompanyFieldsForFocus,
  regimeCode: '1' | '2' | '3' | '4',
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const focusPayload = buildFocusEmpresaPayload(
      {
        cnpj: companyFields.cnpj,
        razao_social: companyFields.razao_social,
        nome: companyFields.nome ?? null,
        logradouro: companyFields.logradouro,
        numero: companyFields.numero ?? null,
        sem_numero: companyFields.sem_numero ?? null,
        complemento: null, // companyObject não tem complemento ainda; fica vazio
        bairro: companyFields.bairro ?? null,
        municipio: companyFields.municipio,
        uf: companyFields.uf,
        cep: companyFields.cep ?? null,
        email: companyFields.email ?? null,
        telefone: companyFields.telefone ?? null,
        inscricao_estadual: companyFields.inscricao_estadual ?? null,
        inscricao_municipal: companyFields.inscricao_municipal ?? null,
      },
      regimeCode,
    );

    const resp = await focus.criarEmpresa(focusPayload, 'hom');
    const token = resp.token_homologacao ?? resp.token_producao ?? null;

    await supabase
      .from('companies')
      .update({
        focus_token: token,
        focus_status: 'ok',
        focus_last_check: now,
        focus_last_error: null,
      })
      .eq('id', companyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[createCompany] Focus POST falhou:', msg);
    await supabase
      .from('companies')
      .update({
        focus_status: 'erro',
        focus_last_check: now,
        focus_last_error: msg.slice(0, 500),
      })
      .eq('id', companyId);
  }
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
