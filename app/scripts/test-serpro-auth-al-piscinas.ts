/**
 * Smoke real: autentica na Serpro Integra Contador via mTLS
 * usando o certificado da AL PISCINAS LTDA (CNPJ 10358425000120).
 *
 * Fluxo:
 *   1. Baixa certificado.enc do Supabase Storage (company-certificates)
 *   2. Decifra AES-256-GCM com CERT_ENC_KEY
 *   3. Extrai keyPem + certPem do JSON
 *   4. POST mTLS em autenticacao.sapi.serpro.gov.br/authenticate
 *   5. Imprime jwt_token / access_token / expiration
 *
 * Uso:
 *   npx tsx scripts/test-serpro-auth-al-piscinas.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ─── Carregar .env.local ───────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

// ─── Constantes ───────────────────────────────────────────────────────────
const COMPANY_ID  = '41a9c2a4-241f-40b0-a1c5-da3fced49359'; // AL PISCINAS LTDA
const CERT_PATH   = `${COMPANY_ID}/certificado.enc`;
const BUCKET      = 'company-certificates';
const AUTH_HOST   = 'autenticacao.sapi.serpro.gov.br';
const AUTH_PATH_  = '/authenticate';
const IV_LEN      = 12;
const TAG_LEN     = 16;

// ─── Helpers ──────────────────────────────────────────────────────────────
function decryptBlob(blob: Buffer): Buffer {
  const encKey = process.env.CERT_ENC_KEY;
  if (!encKey) throw new Error('CERT_ENC_KEY não configurado');
  const key = Buffer.from(encKey, 'base64');
  if (key.length !== 32) throw new Error('CERT_ENC_KEY deve ter 32 bytes em base64');

  const iv  = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct  = blob.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function mTlsPost(keyPem: string, certPem: string, body: string): Promise<string> {
  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET não configurados');

  const basic = 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: AUTH_HOST,
        path: AUTH_PATH_,
        method: 'POST',
        key: keyPem,
        cert: certPem,
        headers: {
          Authorization: basic,
          'role-type': 'TERCEIROS',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          console.log(`\n→ HTTP ${res.statusCode}`);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SERPRO /authenticate → ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error('Timeout 15s')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase env vars ausentes');

  console.log('1/4 Baixando certificado do Storage…');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: blob, error } = await admin.storage.from(BUCKET).download(CERT_PATH);
  if (error || !blob) throw new Error(`Download falhou: ${error?.message ?? 'sem dados'}`);
  const encBytes = Buffer.from(await blob.arrayBuffer());
  console.log(`   ${encBytes.length} bytes baixados de ${CERT_PATH}`);

  console.log('2/4 Decifrando AES-256-GCM…');
  const plaintext = decryptBlob(encBytes);
  const { keyPem, certPem, chainPem } = JSON.parse(plaintext.toString('utf8')) as {
    keyPem: string; certPem: string; chainPem: string;
  };
  console.log('   OK — keyPem:', keyPem.slice(0, 40).replace(/\n/g, '↵'), '…');

  console.log('3/4 Chamando Serpro mTLS /authenticate…');
  const fullCertPem = certPem + (chainPem ?? '');
  const raw = await mTlsPost(keyPem, fullCertPem, 'grant_type=client_credentials');

  console.log('4/4 Parseando resposta…');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Serpro retornou não-JSON: ${raw.slice(0, 300)}`);
  }

  const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  const expiration = new Date(Date.now() + ttl * 1000).toISOString();

  console.log('\n✅ Autenticação bem-sucedida!\n');
  console.log('  access_token:', String(json.access_token ?? '').slice(0, 40), '…');
  console.log('  jwt_token   :', String(json.jwt_token ?? '').slice(0, 40), '…');
  console.log('  expires_in  :', ttl, 's');
  console.log('  expiration  :', expiration);
  console.log('\nPayload completo:');
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error('\n❌ ERRO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
