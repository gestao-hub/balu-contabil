// @custom — Onda 4 hardening — Upload de certificados digitais para Supabase Storage.
// Usa SERVICE_ROLE — NUNCA importar em código client-side.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'company-certificates';

let _admin: SupabaseClient | null = null;

function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados');
  }
  _admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Faz upload de um blob cifrado (envelope AES-GCM opaco) no bucket privado `company-certificates`,
 * sob o path `${companyId}/${fileName}`. Retorna `{path}` em caso de sucesso.
 */
export async function uploadCertificado(
  file: ArrayBuffer | Buffer,
  fileName: string,
  companyId: string,
): Promise<{ path: string }> {
  if (!companyId) throw new Error('companyId obrigatório');
  if (!fileName)  throw new Error('fileName obrigatório');

  const path = `${companyId}/${fileName}`;
  const data: Buffer = Buffer.isBuffer(file) ? file : Buffer.from(new Uint8Array(file));

  const { error } = await admin()
    .storage
    .from(BUCKET)
    .upload(path, data, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) throw new Error(`Supabase Storage upload falhou: ${error.message}`);
  return { path };
}

export const ABERTURA_BUCKET = 'abertura-documentos';

/** Upload genérico para qualquer bucket privado, com o admin client (ignora RLS). */
export async function uploadToBucket(
  bucket: string,
  path: string,
  file: ArrayBuffer | Buffer,
  contentType = 'application/octet-stream',
): Promise<{ path: string }> {
  const data: Buffer = Buffer.isBuffer(file) ? file : Buffer.from(new Uint8Array(file));
  const { error } = await admin().storage.from(bucket).upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`Supabase Storage upload falhou: ${error.message}`);
  return { path };
}

/** Lê os bytes de um arquivo do bucket (para recomputar content-hash na alteração). */
export async function downloadFromBucket(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Supabase Storage download falhou: ${error?.message ?? 'sem dados'}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Baixa o blob cifrado do certificado da empresa a partir do `storage_key` em `arquivos_auxiliares`. */
export async function downloadCertificado(path: string): Promise<Buffer> {
  return downloadFromBucket(BUCKET, path);
}

// Task 18: branding do escritório (white-label). Bucket privado, 1 logo por
// contabilidade — o nome do arquivo é fixo (`logo.<ext>`), então re-upload
// substitui o anterior (uploadToBucket já faz upsert:true).
export const BRANDING_BUCKET = 'branding';

/** Sobe (ou substitui) o logo do escritório em `${contabilidadeId}/logo.${ext}`. */
export async function uploadLogoEscritorio(
  contabilidadeId: string,
  file: Buffer,
  ext: 'png' | 'jpg' | 'svg',
  contentType: string,
): Promise<{ path: string }> {
  const path = `${contabilidadeId}/logo.${ext}`;
  return uploadToBucket(BRANDING_BUCKET, path, file, contentType);
}

/** URL assinada (bucket privado) pra exibir o logo do escritório no app do cliente. */
export async function signedUrlBranding(path: string, expiresInSec = 3600): Promise<string | null> {
  const { data } = await admin().storage.from(BRANDING_BUCKET).createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}

/** Sobe um documento de abertura em `${scopeId}/${fileName}` no bucket de abertura. */
export async function uploadAberturaDoc(
  scopeId: string,
  fileName: string,
  file: ArrayBuffer | Buffer,
  contentType: string,
): Promise<{ path: string }> {
  // path traversal guard: scopeId deve ser UUID-like, fileName sem diretórios
  if (!scopeId || !/^[\w-]+$/.test(scopeId)) throw new Error('scopeId inválido');
  const { basename } = await import('node:path');
  const safeName = basename(fileName);
  if (!safeName || safeName.startsWith('.')) throw new Error('fileName inválido');
  return uploadToBucket(ABERTURA_BUCKET, `${scopeId}/${safeName}`, file, contentType);
}
