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
