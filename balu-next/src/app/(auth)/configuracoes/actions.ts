// @custom — bubble-behavior: Configurações da empresa (PRD §8)
// Server actions de edição de dados da empresa atual.
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { CompanySchema, type CompanyInput, EmpresaFiscalSchema, type EmpresaFiscalInput } from '@/types/zod';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import { uploadCertificado as storageUploadCertificado } from '@/lib/clients/supabase-storage';
import { n8n } from '@/lib/clients/n8n';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';

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

  const buf = await file.arrayBuffer();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(buf, file.name, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }

  // Upsert em arquivos_auxiliares por unique_id_empresa (reusa unique_id_bubble se já existe).
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id, unique_id_bubble')
    .eq('unique_id_empresa', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  const uniqueIdBubble = (existing?.unique_id_bubble as string | null) ?? crypto.randomUUID();

  if (existing) {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .update({ supabase_file_path: path, cert_password: senha, updated_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .insert({ unique_id_empresa: companyId, unique_id_bubble: uniqueIdBubble, supabase_file_path: path, cert_password: senha });
    if (error) return { ok: false, error: error.message };
  }

  // Notifica o n8n DEPOIS de salvar — falha do n8n não perde o certificado.
  let warning: string | undefined;
  try {
    await n8n.uploadCertificado({
      unique_id_empresa: companyId,
      unique_id_bubble: uniqueIdBubble,
      file_base64: Buffer.from(buf).toString('base64'),
      cert_password: senha,
    });
  } catch {
    warning = 'Certificado salvo, mas o processamento (n8n) falhou — será reprocessado.';
  }

  revalidatePath('/configuracoes');
  return { ok: true, warning };
}
