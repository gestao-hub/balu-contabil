import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptBlob } from '@/lib/crypto/envelope';
import { autenticarContratante } from '@/lib/clients/serpro-auth';
import { isInFutureISO } from '@/lib/fiscal/saude-empresa';

export type Contratante = {
  id: string;
  cnpj: string;
  nome: string;
  pfx: Buffer;
  senha: string;
  authAccessToken: string | null;
  authJwt: string | null;
  authExpiration: string | null;
};

/** Lê o singleton e decifra PFX+senha. Retorna null se não houver contratante configurado. */
export async function getContratante(): Promise<Contratante | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('serpro_contratante')
    .select('id, cnpj, nome, cert_pfx_enc, cert_password_enc, auth_access_token, auth_jwt_token, auth_token_expiration')
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const pfx = decryptBlob(Buffer.from(data.cert_pfx_enc as string, 'base64'));
  const senha = decryptBlob(Buffer.from(data.cert_password_enc as string, 'base64')).toString('utf8');
  return {
    id: data.id as string,
    cnpj: data.cnpj as string,
    nome: (data.nome as string | null) ?? '',
    pfx,
    senha,
    authAccessToken: (data.auth_access_token as string | null) ?? null,
    authJwt: (data.auth_jwt_token as string | null) ?? null,
    authExpiration: (data.auth_token_expiration as string | null) ?? null,
  };
}

/**
 * Garante um par access_token/jwt válido do contratante. Reusa o cache (~1h) ou re-autentica
 * via mTLS e atualiza o singleton. Devolve também pfx/senha para uso no /Apoiar.
 */
export async function garantirAuthContratante(): Promise<{
  accessToken: string;
  jwt: string;
  pfx: Buffer;
  passphrase: string;
  cnpj: string;
  nome: string;
} | null> {
  const c = await getContratante();
  if (!c) return null;

  const SKEW_MS = 60 * 1000;
  if (c.authAccessToken && c.authJwt && isInFutureISO(c.authExpiration, new Date(), SKEW_MS)) {
    return { accessToken: c.authAccessToken, jwt: c.authJwt, pfx: c.pfx, passphrase: c.senha, cnpj: c.cnpj, nome: c.nome };
  }

  const tokens = await autenticarContratante(c.pfx, c.senha);
  const admin = createAdminClient();
  const { error: cacheErr } = await admin
    .from('serpro_contratante')
    .update({
      auth_access_token: tokens.accessToken,
      auth_jwt_token: tokens.jwt,
      auth_token_expiration: tokens.expiration,
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.id);
  if (cacheErr) console.warn('[serpro-contratante] falha ao cachear tokens de auth:', cacheErr.message);
  return { accessToken: tokens.accessToken, jwt: tokens.jwt, pfx: c.pfx, passphrase: c.senha, cnpj: c.cnpj, nome: c.nome };
}
