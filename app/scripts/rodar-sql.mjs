// Roda um arquivo .sql no banco de produção — migration ou consulta.
//
// POR QUE EXISTE. As migrations deste projeto são aplicadas à mão no SQL Editor
// (convenção registrada no CHECKPOINT). Isso funciona, mas não deixa rastro no
// terminal e é fácil aplicar metade de um arquivo com várias partes — a 0106
// tem três. Aqui o arquivo inteiro roda numa TRANSAÇÃO: ou entra todo, ou não
// entra nada.
//
// A conexão é a MESMA de `seed-documentos-lgpd.mjs` (lista de hosts candidatos,
// senha do `.env.local`), para não haver dois jeitos de falar com o banco.
//
// Requer `pg` — já é devDependency do projeto.
//
//   node scripts/rodar-sql.mjs supabase/migrations/0106_....sql
//   node scripts/rodar-sql.mjs supabase/scripts/cnpj-duplicados.sql
//
// SELECT tem a saída impressa. DDL/DML mostram a contagem de linhas afetadas.
// Nada é aplicado se qualquer comando do arquivo falhar.
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

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node scripts/rodar-sql.mjs <caminho-do-arquivo.sql>');
  process.exit(1);
}
const caminho = path.resolve(process.cwd(), arquivo);
if (!fs.existsSync(caminho)) {
  console.error(`ERRO: arquivo não encontrado: ${caminho}`);
  process.exit(1);
}
const sql = fs.readFileSync(caminho, 'utf8');

const candidates = [
  { host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { host: 'aws-0-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
  { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
];

async function connect(password) {
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
  const client = await connect(readEnv('SUPABASE_PASSWORD'));
  console.log(`[arquivo] ${path.basename(caminho)} (${sql.length} chars)`);
  try {
    await client.query('BEGIN');
    // `pg` devolve array de resultados quando o texto tem vários comandos.
    const res = await client.query(sql);
    const resultados = Array.isArray(res) ? res : [res];
    for (const r of resultados) {
      if (r.command === 'SELECT') {
        console.log(`\n[${r.rowCount} linha(s)]`);
        if (r.rowCount > 0) console.table(r.rows);
      } else if (r.command) {
        console.log(`[${r.command}] ${r.rowCount ?? 0} linha(s)`);
      }
    }
    await client.query('COMMIT');
    console.log('\n[OK] transação confirmada.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // A 0106 aborta de propósito com RAISE EXCEPTION quando há duplicata — a
    // mensagem dela é o resultado útil, não um crash. Por isso vem limpa.
    console.error('\n[ABORTADO — nada foi aplicado]');
    console.error(e.message);
    if (e.hint) console.error(`dica: ${e.hint}`);
    process.exit(1);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
