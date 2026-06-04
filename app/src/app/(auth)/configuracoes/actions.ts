// @custom — bubble-behavior: Configurações da empresa (PRD §8)
// Server actions de edição de dados da empresa atual.
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { CompanySchema, type CompanyInput, EmpresaFiscalSchema, type EmpresaFiscalInput } from '@/types/zod';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import { syncEmpresaNaFocus, atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import { isAderenteNfsenNacional } from '@/lib/fiscal/municipios-nfsen-nacional';
import { uploadCertificado as storageUploadCertificado } from '@/lib/clients/supabase-storage';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
import { parsePkcs12, type CertMaterial } from '@/lib/fiscal/pkcs12';
import { encryptBlob } from '@/lib/crypto/envelope';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';

type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

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
      .update({ ...data, updated_at: new Date().toISOString() })
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
      .insert({ ...data, empresa_id: companyId, owner_user_id: user.id, cnpj: company?.cnpj ?? null });
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
        const r = await atualizarEmpresaNaFocus(supabase, companyId, 'hom', {
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
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // Abre o PFX legado com node-forge (valida a senha de verdade) e extrai metadados.
  const buf = Buffer.from(await file.arrayBuffer());
  let material: CertMaterial;
  try {
    material = parsePkcs12(buf, senha);
  } catch {
    return { ok: false, error: 'Não foi possível abrir o certificado. Verifique o arquivo e a senha.' };
  }
  if (new Date(material.notAfter).getTime() < Date.now()) {
    return { ok: false, error: `Certificado expirado em ${new Date(material.notAfter).toLocaleDateString('pt-BR')}.` };
  }

  // Re-cifra o material de chave (key+cert+cadeia) com a chave do app; a senha do cert é descartada.
  let blob: Buffer;
  try {
    blob = encryptBlob(
      Buffer.from(JSON.stringify({ keyPem: material.keyPem, certPem: material.certPem, chainPem: material.chainPem }), 'utf8'),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro interno ao cifrar o certificado.' };
  }

  // Nome fixo: 1 cert por empresa; upsert:true sobrescreve no re-upload.
  const CERT_FILENAME = 'certificado.enc';
  // Decide insert vs update (registro existente da empresa).
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, CERT_FILENAME, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }

  const row = {
    supabase_file_path: path,
    storage_key: path,
    cert_password: null,
    cert_not_after: material.notAfter,
    cert_subject_cn: material.subjectCN,
    cert_cnpj: material.cnpj,
    cert_fingerprint: material.fingerprintSha256,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from('arquivos_auxiliares').update(row).eq('id', (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .insert({ company_id: companyId, ...row });
    if (error) return { ok: false, error: error.message };
  }

  // Best-effort: gera o token_procurador (mTLS contratante + Termo assinado pela empresa).
  // Falha não perde o certificado.
  const warnings: string[] = [];
  {
    const r = await garantirTokenProcurador(supabase, companyId, {
      keyPem: material.keyPem,
      certPem: material.certPem,
      cnpj: material.cnpj,
      nome: material.subjectCN,
    });
    if (!r.ok) warnings.push(r.warning);
  }

  // Focus 2.2 (best-effort): se a empresa já tem cadastro na Focus, envia o
  // PFX + senha (em base64) no mesmo PUT do payload base. Esse é o ÚNICO
  // momento em que temos a senha original do PFX em memória; depois daqui ela
  // é descartada (apenas o material PEM cifrado fica em Storage).
  // Pular silenciosamente quando focus_empresa_id ainda não existe — esse caso
  // é resolvido depois clicando "Sincronizar com Focus" no Diagnóstico (Focus 1).
  const { data: fiscalForFocus } = await supabase
    .from('empresas_fiscais')
    .select('focus_empresa_id')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (fiscalForFocus?.focus_empresa_id != null) {
    const focusResult = await atualizarEmpresaNaFocus(supabase, companyId, 'hom', {
      certificado: { base64: buf.toString('base64'), senha },
    });
    if (!focusResult.ok) {
      warnings.push(`Certificado salvo localmente, mas falhou ao enviar pra Focus: ${focusResult.error.slice(0, 200)}`);
    }
  }

  // Zera a senha do PFX da nossa stack frame (defesa em profundidade — após o
  // return, o GC eventualmente coleta; explicitar reforça a intenção).
  // Nota: strings em JS são imutáveis; isto não sobrescreve a string original,
  // só remove a referência local. Pra apagar mesmo seria preciso Uint8Array.
  // Mantemos `senha` como const pra não dar reatribuição — o ponto é doc.

  revalidatePath('/configuracoes');
  const warning = warnings.length ? warnings.join(' ') : undefined;
  return { ok: true, warning };
}

/**
 * Botão "Sincronizar com Focus" no Diagnóstico.
 *
 * Comportamento adaptativo:
 *  - Empresa SEM `focus_token`  → POST /v2/empresas (cadastro inicial — Focus 1)
 *  - Empresa COM `focus_token`  → PUT /v2/empresas/:cnpj (atualização — Focus 2.1)
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

  const { data: company } = await supabase
    .from('companies')
    .select('focus_token')
    .eq('id', companyId)
    .single();

  const result = company?.focus_token
    ? await atualizarEmpresaNaFocus(supabase, companyId, 'hom')
    : await syncEmpresaNaFocus(supabase, companyId);

  revalidatePath('/configuracoes');
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** @deprecated use syncFocusEmpresaAction. Mantido pra não quebrar callers durante a migração. */
export const retryFocusEmpresaAction = syncFocusEmpresaAction;
