// Task 15 — Bloco E (Hardening/LGPD): publica as minutas de Política de
// Privacidade e Termos de Uso em `documento_versoes` (versão 1.0), para que o
// gate de aceite (`app/src/lib/lgpd/pendencia-aceite.ts`) e a página `/aceite`
// tenham conteúdo vigente para exibir.
//
// NÃO EXECUTADO por este worker — o controller roda este script (precisa de
// acesso ao banco). Requer `pg` instalado (`npm i pg` — não é dependência do
// projeto) e `SUPABASE_PASSWORD` em `app/.env.local`.
//
// Idempotente: `ON CONFLICT (tipo, versao) DO UPDATE` — pode ser rodado de
// novo com segurança se o conteúdo das minutas mudar antes da versão 1.0 ir
// para produção.
//
// Rodar de app/: node scripts/seed-documentos-lgpd.mjs
import fs from 'node:fs';
import path from 'node:path';
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

const DOCS_DIR = new URL('../../docs/legal/', import.meta.url);
const DOCUMENTOS = [
  { tipo: 'privacidade', arquivo: 'politica-de-privacidade-v1.md', versao: '1.0' },
  { tipo: 'termos', arquivo: 'termos-de-uso-v1.md', versao: '1.0' },
];

function lerMinuta(nomeArquivo) {
  const p = new URL(nomeArquivo, DOCS_DIR);
  return fs.readFileSync(p, 'utf8');
}

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
    let upserts = 0;
    for (const doc of DOCUMENTOS) {
      const conteudo = lerMinuta(doc.arquivo);
      await client.query(
        `INSERT INTO documento_versoes (tipo, versao, conteudo_md, publicado_em)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (tipo, versao)
         DO UPDATE SET conteudo_md = EXCLUDED.conteudo_md, publicado_em = now()`,
        [doc.tipo, doc.versao, conteudo],
      );
      upserts++;
      console.log(`[upsert] ${doc.tipo} v${doc.versao} <- ${path.basename(doc.arquivo)} (${conteudo.length} chars)`);
    }
    console.log(`[seed] ${upserts} documento(s) publicado(s) em documento_versoes.`);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
