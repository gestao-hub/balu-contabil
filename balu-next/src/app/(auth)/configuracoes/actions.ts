// @custom — bubble-behavior: Configurações da empresa (PRD §8)
// Server actions de edição de dados da empresa atual.
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { CompanySchema, type CompanyInput, EmpresaFiscalSchema, type EmpresaFiscalInput } from '@/types/zod';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import { uploadCertificado as storageUploadCertificado } from '@/lib/clients/supabase-storage';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
import { parsePkcs12, type CertMaterial } from '@/lib/fiscal/pkcs12';
import { encryptBlob } from '@/lib/crypto/envelope';
import { autenticarProcurador } from '@/lib/clients/serpro-auth';

type ActionResult = { ok: true } | { ok: false; error: string };

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

  const { error } = await supabase
    .from('companies')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

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
    .select('id')
    .eq('empresa_id', companyId)
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('empresas_fiscais')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('empresa_id', companyId)
      .eq('owner_user_id', user.id);
    if (error) return { ok: false, error: error.message };
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

  revalidatePath('/configuracoes');
  return { ok: true };
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

  // Reaproveita unique_id_bubble se já existe registro pra empresa.
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id, unique_id_bubble')
    .eq('unique_id_empresa', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  const uniqueIdBubble = (existing?.unique_id_bubble as string | null) ?? crypto.randomUUID();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, `${uniqueIdBubble}.enc`, companyId));
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
      .insert({ unique_id_empresa: companyId, unique_id_bubble: uniqueIdBubble, ...row });
    if (error) return { ok: false, error: error.message };
  }

  // Best-effort: autentica na SERPRO e cacheia o JWT. Falha não perde o certificado.
  let warning: string | undefined;
  try {
    const tokens = await autenticarProcurador(material.keyPem, material.certPem + material.chainPem);
    const { data: fiscalRows } = await supabase
      .from('empresas_fiscais')
      .update({
        certificado_jwt: tokens.jwt,
        certificado_access_token: tokens.accessToken,
        certificado_token_expiration: tokens.expiration,
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', companyId)
      .select('empresa_id');
    if (!fiscalRows || fiscalRows.length === 0) {
      warning = 'Certificado salvo. Conclua o cadastro fiscal (NFS-e) para ativar a autenticação na SERPRO.';
    }
  } catch {
    warning = 'Certificado salvo, mas a autenticação na SERPRO falhou — será refeita depois.';
  }

  revalidatePath('/configuracoes');
  return { ok: true, warning };
}
