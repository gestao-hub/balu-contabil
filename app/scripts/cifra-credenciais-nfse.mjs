// Task 10 — Bloco E (Hardening/LGPD): cifra em repouso as credenciais NFS-e
// legadas de `empresas_fiscais` que ainda estão em texto claro.
//
// One-off já executado em 2026-07-22 (0 linhas em claro na produção). Mantido
// para re-execução em outro ambiente. Requer `pg` instalado (`npm i pg` — não é
// dependência do projeto) e `SUPABASE_PASSWORD`/`CERT_ENC_KEY` no app/.env.local.
//
// Idempotente: só re-cifra linhas onde o valor NÃO começa com o prefixo
// `enc:v1:` (mesma convenção de src/lib/crypto/envelope.ts: cifrarCampo/decifrarCampo).
// Replica a lógica AES-256-GCM inline (node:crypto) porque o script roda fora
// do bundler do Next e não importa TS diretamente.
//
// Rodar de app/: node scripts/cifra-credenciais-nfse.mjs
import fs from 'node:fs';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Client } from 'pg';

const ENV_PATH = new URL('../.env.local', import.meta.url);
const REF = 'llykzqnugdpojwnlontj';

function readEnv(key) {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith(key + '='));
  if (!line) throw new Error(`${key} não encontrado em .env.local`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

const password = readEnv('SUPABASE_PASSWORD');
const certEncKeyB64 = readEnv('CERT_ENC_KEY');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIXO = 'enc:v1:';

function key() {
  const k = Buffer.from(certEncKeyB64, 'base64');
  if (k.length !== 32) throw new Error('CERT_ENC_KEY deve decodificar para 32 bytes (AES-256).');
  return k;
}

/** Réplica de cifrarCampo (src/lib/crypto/envelope.ts) — mesmo formato/prefixo. */
function cifrarCampo(v) {
  if (!v) return v;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIXO + Buffer.concat([iv, tag, enc]).toString('base64');
}

const CAMPOS = [
  'nfse_senha_login',
  'nfse_token_api',
  'nfse_chave_api',
  'nfse_frase_secreta',
  'token_portal',
  'senha_responsavel',
];

const candidates = [
  { host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { host: 'aws-0-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
  { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
];

async function connect() {
  let lastErr;
  for (const c of candidates) {
    const client = new Client({
      host: c.host, port: c.port, user: c.user, password,
      database: 'postgres', ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      console.log(`[conectado] ${c.host}`);
      return client;
    } catch (e) {
      lastErr = e;
      console.log(`[falhou] ${c.host}: ${e.message}`);
      try { await client.end(); } catch {}
    }
  }
  throw lastErr;
}

(async () => {
  const client = await connect();
  try {
    const whereClaro = CAMPOS
      .map((c) => `(${c} IS NOT NULL AND ${c} NOT LIKE '${PREFIXO}%')`)
      .join(' OR ');
    const { rows } = await client.query(
      `SELECT id, ${CAMPOS.join(', ')} FROM empresas_fiscais WHERE ${whereClaro}`,
    );
    console.log(`[scan] ${rows.length} linha(s) com algum campo em claro.`);

    let linhasAtualizadas = 0;
    let camposAtualizados = 0;
    for (const row of rows) {
      const sets = [];
      const values = [];
      let i = 1;
      for (const campo of CAMPOS) {
        const v = row[campo];
        if (typeof v === 'string' && v && !v.startsWith(PREFIXO)) {
          sets.push(`${campo} = $${i++}`);
          values.push(cifrarCampo(v));
          camposAtualizados++;
        }
      }
      if (sets.length === 0) continue;
      values.push(row.id);
      await client.query(
        `UPDATE empresas_fiscais SET ${sets.join(', ')} WHERE id = $${i}`,
        values,
      );
      linhasAtualizadas++;
    }
    console.log(`[cifra] ${linhasAtualizadas} linha(s) atualizada(s), ${camposAtualizados} campo(s) cifrado(s).`);

    // Verificação final: nenhum valor em claro deve restar.
    const { rows: restante } = await client.query(
      `SELECT count(*)::int AS claro FROM empresas_fiscais WHERE ${whereClaro}`,
    );
    console.log(`[verify] linhas ainda em claro: ${restante[0].claro}`);
    if (restante[0].claro > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
