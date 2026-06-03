// @custom — Autenticar Procurador na SERPRO Integra Contador via mTLS com o certificado do contratante.
// Substitui o webhook n8n /post-autenticacao. server-only (faz I/O de rede com material de chave).
import 'server-only';
import https from 'node:https';

const AUTH_HOST = 'autenticacao.sapi.serpro.gov.br';
const AUTH_PATH = '/authenticate';

export type ProcuradorTokens = { jwt: string; accessToken: string; expiration: string };

/** Parser puro da resposta do /authenticate. Testável sem rede. */
export function parseAuthResponse(raw: unknown): ProcuradorTokens {
  const r = raw as { jwt_token?: unknown; access_token?: unknown; expires_in?: unknown };
  if (!r || typeof r.jwt_token !== 'string' || typeof r.access_token !== 'string') {
    throw new Error('Resposta de autenticação SERPRO inválida (sem jwt_token/access_token).');
  }
  const ttlMs = (typeof r.expires_in === 'number' ? r.expires_in : 3600) * 1000;
  return {
    jwt: r.jwt_token,
    accessToken: r.access_token,
    expiration: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/**
 * mTLS com o PFX do CONTRATANTE (cert fixo da Balu). Consumer key/secret globais via env.
 * role-type TERCEIROS (modelo software-house / Termo de Autorização).
 */
export async function autenticarContratante(pfx: Buffer, passphrase: string): Promise<ProcuradorTokens> {
  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET não configurados');

  const basic = 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');
  const body = 'grant_type=client_credentials';

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: AUTH_HOST,
        path: AUTH_PATH,
        method: 'POST',
        pfx,
        passphrase,
        headers: {
          Authorization: basic,
          'role-type': 'TERCEIROS',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SERPRO /authenticate → ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('SERPRO /authenticate: timeout (10s).')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`SERPRO /authenticate retornou não-JSON: ${raw.slice(0, 200)}`);
  }
  return parseAuthResponse(json);
}
