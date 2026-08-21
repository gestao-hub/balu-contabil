// Migra companies.focus_token (texto puro) para empresa_credenciais_focus.token_hom_cifrado.
// Idempotente: pula quem já tem a coluna nova preenchida.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const chave = Buffer.from(env.CERT_ENC_KEY, 'base64');
if (chave.length !== 32) throw new Error('CERT_ENC_KEY nao decodifica para 32 bytes');

/** Idêntico a cifrarCampo de lib/crypto/envelope.ts. */
function cifrarCampo(v) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const client = new pg.Client({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
  password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `select c.id, c.nome, c.focus_token
     from public.companies c
     left join public.empresa_credenciais_focus e on e.empresa_id = c.id
    where c.focus_token is not null and c.focus_token <> ''
      and e.token_hom_cifrado is null`,
);
console.log(`empresas a migrar: ${rows.length}`);

for (const r of rows) {
  // Numa transacao: gravar a credencial e esvaziar a coluna velha tem de ser
  // atomico. Se o segundo falhasse sozinho, o token ficaria em DOIS lugares —
  // um deles legivel por authenticated, que e exatamente o que a 0097 fecha.
  await client.query('begin');
  try {
    await client.query(
      `insert into public.empresa_credenciais_focus (empresa_id, token_hom_cifrado, atualizado_em)
       values ($1, $2, now())
       on conflict (empresa_id) do update
         set token_hom_cifrado = excluded.token_hom_cifrado, atualizado_em = now()`,
      [r.id, cifrarCampo(r.focus_token)],
    );
    await client.query('update public.companies set focus_token = null where id = $1', [r.id]);
    await client.query('commit');
    console.log(`  ${r.nome}: migrado`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const conf = await client.query(
  `select (select count(*) from public.companies
            where focus_token is not null and focus_token <> '')::int as em_claro,
          (select count(*) from public.empresa_credenciais_focus
            where token_hom_cifrado like 'enc:v1:%')::int as cifrados`,
);
console.log('\napos migrar → em claro:', conf.rows[0].em_claro, '| cifrados:', conf.rows[0].cifrados);
await client.end();
if (conf.rows[0].em_claro > 0) process.exit(1);
