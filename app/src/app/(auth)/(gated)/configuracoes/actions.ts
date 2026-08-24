// @custom — bubble-behavior: Configurações da empresa (PRD §8)
// Server actions de edição de dados da empresa atual.
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { assertAceitesEmDia } from '@/lib/lgpd/pendencia-aceite';
import { CompanySchema, type CompanyInput, EmpresaFiscalSchema, type EmpresaFiscalInput } from '@/types/zod';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import { syncEmpresaNaFocus, atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import { isAderenteNfsenNacional } from '@/lib/fiscal/municipios-nfsen-nacional';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
import { processarUploadCertificado } from '@/lib/fiscal/cert-upload';
import { cifrarCampo } from '@/lib/crypto/envelope';
import { lookupCnpj } from '@/lib/fiscal/cnpj-lookup';
import { camposOficiaisDaReceita } from '@/lib/fiscal/campos-empresa';
import { sincronizarCnaesEmpresa } from '@/lib/fiscal/cnae-sync';
import { ibgePorCep } from '@/lib/fiscal/ibge-por-cep';

type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

// Task 10 — credenciais NFS-e cifradas em repouso (AES-256-GCM, prefixo enc:v1:).
// Aplica cifrarCampo em qualquer um desses campos presente no patch antes de
// gravar em `empresas_fiscais`. Strings vazias passam direto (cifrarCampo já
// trata); valores ausentes (undefined) não entram no objeto e não são tocados.
const CAMPOS_CREDENCIAL_NFSE = [
  'nfse_senha_login',
  'nfse_token_api',
  'nfse_chave_api',
  'nfse_frase_secreta',
  'token_portal',
  'senha_responsavel',
] as const;

function cifrarCredenciaisNfse<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const campo of CAMPOS_CREDENCIAL_NFSE) {
    const v = out[campo];
    if (typeof v === 'string' && v) out[campo] = cifrarCampo(v);
  }
  return out as T;
}

// Campos de `companies` que entram no payload da Focus (buildFocusEmpresaPayload).
// Editar qualquer um = drift até re-sincronizar. cnpj é imutável na edição.
const FOCUS_COMPANY_FIELDS = [
  'razao_social', 'nome', 'logradouro', 'numero', 'sem_numero', 'complemento',
  'bairro', 'municipio', 'uf', 'cep', 'email', 'telefone',
  'inscricao_estadual', 'inscricao_municipal',
] as const;

/**
 * Marca que um campo do payload Focus mudou (Diagnóstico mostra "há mudanças não
 * sincronizadas"). Best-effort: se a empresa não tem empresa_fiscal ainda, ou a
 * coluna não existir (migration 0019 não aplicada), apenas loga — a detecção de
 * drift degrada graciosamente (sem bump = sem drift).
 */
async function markFocusFieldsDirty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
): Promise<void> {
  const { error } = await supabase
    .from('empresas_fiscais')
    .update({ focus_fields_dirty_at: new Date().toISOString() })
    .eq('empresa_id', companyId)
    .is('deleted_at', null);
  if (error) console.warn('[markFocusFieldsDirty]', error.message);
}

export async function updateCompanyAction(id: string, patch: Partial<CompanyInput>): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID da empresa ausente.' };

  // Validação completa: o form de edição envia todos os campos, e o endereço
  // (rua/cidade/estado) é obrigatório — então NÃO usamos .partial() aqui.
  const parsed = CompanySchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Snapshot dos campos Focus antes do update, pra detectar mudança relevante.
  const { data: before } = await supabase
    .from('companies')
    .select(FOCUS_COMPANY_FIELDS.join(','))
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  const { error } = await supabase
    .from('companies')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  // Se algum campo do payload Focus mudou, marca drift (compara como string pra
  // tratar null/''/undefined de forma equivalente).
  const norm = (v: unknown) => String(v ?? '');
  const beforeRow = before as unknown as Record<string, unknown> | null;
  const focusChanged =
    !beforeRow ||
    FOCUS_COMPANY_FIELDS.some(
      (f) => norm((parsed.data as Record<string, unknown>)[f]) !== norm(beforeRow[f]),
    );
  if (focusChanged) await markFocusFieldsDirty(supabase, id);

  revalidatePath('/configuracoes');
  revalidatePath('/');
  return { ok: true };
}

export async function upsertEmpresaFiscalAction(patch: Partial<EmpresaFiscalInput>): Promise<ActionResult> {
  const parsed = EmpresaFiscalSchema.partial().safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }
  // Inclui os campos NFS-e (parsed.data) + normalização de regime por cima.
  const data = { ...parsed.data, ...normalizeRegimePatch(parsed.data) };
  // Cifra as credenciais NFS-e (Task 10) antes de gravar — nunca em claro no banco.
  const dataCifrado = cifrarCredenciaisNfse(data);

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const gate = await assertAceitesEmDia(user.id);
  if (!gate.ok) return { ok: false, error: gate.error };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { data: existing } = await supabase
    .from('empresas_fiscais')
    .select('id, Code_regime_tributario')
    .eq('empresa_id', companyId)
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    // Regime é o único campo de empresas_fiscais que entra no payload da Focus.
    const regimeMudou =
      data.Code_regime_tributario != null &&
      data.Code_regime_tributario !== (existing as { Code_regime_tributario?: string | null }).Code_regime_tributario;
    const { error } = await supabase
      .from('empresas_fiscais')
      .update({ ...dataCifrado, updated_at: new Date().toISOString() })
      .eq('empresa_id', companyId)
      .eq('owner_user_id', user.id);
    if (error) return { ok: false, error: error.message };
    // Drift à parte (best-effort) pra não acoplar o save à coluna 0019.
    if (regimeMudou) await markFocusFieldsDirty(supabase, companyId);
  } else {
    const { data: company } = await supabase
      .from('companies')
      .select('cnpj')
      .eq('id', companyId)
      .single();
    const { error } = await supabase
      .from('empresas_fiscais')
      .insert({ ...dataCifrado, empresa_id: companyId, owner_user_id: user.id, cnpj: company?.cnpj ?? null });
    if (error) return { ok: false, error: error.message };
  }

  // Focus 2.2 (best-effort): se o patch incluiu credenciais prefeitura
  // (login+senha NFS-e) e a empresa já tem cadastro na Focus, envia esses
  // campos no mesmo PUT do payload base. Só faz sentido em município legado
  // (NFSe Nacional não usa autenticação por prefeitura via Focus).
  let warning: string | undefined;
  const loginRaw = (patch.nfse_usuario_login ?? '').trim();
  const senhaRaw = (patch.nfse_senha_login ?? '').trim();
  if (loginRaw && senhaRaw) {
    const { data: ctx } = await supabase
      .from('empresas_fiscais')
      .select('focus_empresa_id, focus_codigo_municipio')
      .eq('empresa_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    const focusEmpresaId = ctx?.focus_empresa_id as number | null;
    if (focusEmpresaId != null) {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('codigo_municipio')
        .eq('id', companyId)
        .single();
      const codigoIbge =
        (ctx?.focus_codigo_municipio as string | null) ||
        (companyRow?.codigo_municipio as string | null) ||
        null;
      if (!isAderenteNfsenNacional(codigoIbge)) {
        // Sem ambiente literal: quem decide é `empresas_fiscais.focus_ambiente`.
        const r = await atualizarEmpresaNaFocus(supabase, companyId, undefined, {
          credenciaisPrefeitura: { login: loginRaw, senha: senhaRaw },
        });
        if (!r.ok) {
          warning = `Salvo localmente, mas falha ao enviar credenciais pra Focus: ${r.error.slice(0, 200)}`;
        }
      }
    }
  }

  revalidatePath('/configuracoes');
  return warning ? { ok: true, warning } : { ok: true };
}

export async function uploadCertificadoAction(
  formData: FormData,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const file = formData.get('file');
  const senha = String(formData.get('senha') ?? '');
  if (!(file instanceof File)) return { ok: false, error: 'Selecione o arquivo do certificado.' };

  const v = validateCertificadoUpload({ name: file.name, size: file.size, senha });
  if (!v.ok) return v;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const gate = await assertAceitesEmDia(user.id);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // O núcleo (abrir PFX, conferir CNPJ, cifrar, subir, gravar, token+Focus) mora
  // em lib/fiscal/cert-upload.ts porque o contador sobe o certificado do cliente
  // pelo painel (0085) e as duas telas precisam da MESMA implementação.
  const buf = Buffer.from(await file.arrayBuffer());
  const r = await processarUploadCertificado(supabase, companyId, { bytes: buf, senha }, user.id);
  if (!r.ok) return r;

  revalidatePath('/configuracoes');
  return r.warnings.length ? { ok: true, warning: r.warnings.join(' ') } : { ok: true };
}

/**
 * Botão "Sincronizar com Focus" no Diagnóstico.
 *
 * Comportamento adaptativo:
 *  - Empresa SEM `empresas_fiscais.focus_empresa_id` → POST /v2/empresas (cadastro inicial — Focus 1)
 *  - Empresa COM `empresas_fiscais.focus_empresa_id` → PUT /v2/empresas/:cnpj (atualização — Focus 2.1)
 *
 * Idempotente: clicar várias vezes só re-sincroniza estado.
 */
export async function syncFocusEmpresaAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = profile?.current_company as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // Bloco 5: o sinal de "ja cadastrada na Focus" e o focus_empresa_id, nao o
  // token. O token saiu de `companies` na Task 2/0097, e gatear nele fazia o
  // botao sempre tentar CADASTRAR DE NOVO uma empresa que ja existe.
  const { data: fiscalSync } = await supabase
    .from('empresas_fiscais')
    .select('focus_empresa_id')
    .eq('empresa_id', companyId)
    .maybeSingle();

  const result = fiscalSync?.focus_empresa_id != null
    ? await atualizarEmpresaNaFocus(supabase, companyId)
    : await syncEmpresaNaFocus(supabase, companyId);

  revalidatePath('/configuracoes');
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** @deprecated use syncFocusEmpresaAction. Mantido pra não quebrar callers durante a migração. */
export const retryFocusEmpresaAction = syncFocusEmpresaAction;

/**
 * Task 18 — LGPD art. 18: a empresa desvincula seu escritório a qualquer momento.
 * O escritório deixa de ver os dados imediatamente (RLS de `minha_contabilidade()`
 * depende de `companies.contabilidade_id`); nada é apagado. Client AUTENTICADO
 * escopado por dono — mesma policy `companies_update` que updateCompanyAction já usa.
 */
export async function desvincularEscritorioAction(companyId: string): Promise<ActionResult> {
  if (!companyId) return { ok: false, error: 'ID da empresa ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('companies')
    .update({ contabilidade_id: null, updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/configuracoes');
  return { ok: true };
}

export type AtualizarReceitaResult =
  | { ok: true; atualizados: Partial<CompanyInput> }
  | { ok: false; error: string };

/**
 * Re-consulta a Receita (Focus /v2/cnpjs) e atualiza os campos oficiais da empresa
 * (razão social + endereço). Mescla sobre os valores atuais e chama updateCompanyAction
 * (que valida com CompanySchema completo e bumpa o drift → "Sincronizar com Focus").
 */
export async function atualizarDadosReceitaAction(id: string): Promise<AtualizarReceitaResult> {
  if (!id) return { ok: false, error: 'ID da empresa ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: company } = await supabase
    .from('companies').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };

  const cnpj = String(company.cnpj ?? '').replace(/\D+/g, '');
  if (cnpj.length !== 14) return { ok: false, error: 'CNPJ inválido.' };

  const r = await lookupCnpj(cnpj);
  if (!r.ok) return { ok: false, error: r.error };

  const patch = camposOficiaisDaReceita(r.data);

  // codigo_municipio (IBGE) não vem da Receita/Focus — resolve pelo CEP quando a empresa
  // ainda não tiver (caso da AL PISCINAS, cadastrada por autofill de CNPJ). Sem ele a
  // NFS-e trava em "Município sem código IBGE".
  if (!((company.codigo_municipio as string | null) ?? '')) {
    const ibge = await ibgePorCep((company.cep as string | null) ?? '');
    if (ibge) patch.codigo_municipio = ibge;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'A Receita não retornou dados para atualizar.' };
  }

  // updateCompanyAction valida com CompanySchema COMPLETO (endereço obrigatório), então mesclamos
  // o patch oficial sobre os valores atuais e enviamos o objeto inteiro.
  const atual: Partial<CompanyInput> = {
    cnpj: company.cnpj as string,
    razao_social: company.razao_social as string,
    nome: (company.nome as string) ?? '',
    inscricao_estadual: (company.inscricao_estadual as string) ?? '',
    inscricao_municipal: (company.inscricao_municipal as string) ?? '',
    codigo_municipio: (company.codigo_municipio as string) ?? '',
    logradouro: (company.logradouro as string) ?? '',
    numero: (company.numero as string) ?? '',
    sem_numero: (company.sem_numero as boolean) ?? false,
    complemento: (company.complemento as string) ?? '',
    bairro: (company.bairro as string) ?? '',
    municipio: (company.municipio as string) ?? '',
    uf: (company.uf as string) ?? '',
    cep: (company.cep as string) ?? '',
    telefone: (company.telefone as string) ?? '',
    email: (company.email as string) ?? '',
  };
  const res = await updateCompanyAction(id, { ...atual, ...patch });
  if (!res.ok) return res;

  // Re-sincroniza os CNAEs (principal + secundários) da BrasilAPI. É o caminho de
  // recuperação quando a sync na criação falhou (BrasilAPI fora/limitando) e deixou
  // os secundários sem popular. Best-effort: não lança, não bloqueia a atualização.
  await sincronizarCnaesEmpresa(supabase, {
    companyId: id,
    ownerUserId: user.id,
    cnpj,
    cnaePrincipalFallback: r.data.cnae_principal ?? null,
  });

  return { ok: true, atualizados: patch };
}
