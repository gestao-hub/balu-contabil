// Carrega os documentos de `docs/legal/*.md` no banco como RASCUNHO.
//
// POR QUE EXISTE. O app lê os documentos de `documento_versoes`, não dos
// arquivos do repositório. A seção 7 (WhatsApp) e as notas ao advogado foram
// escritas no ARQUIVO em 29/08 e nunca entraram no banco — então a tela do
// admin, a página pública e, o que mais importa, os botões de exportar
// continuavam mostrando a 1.0 de 22/07. O Michel exportaria para o advogado
// justamente o texto que precisa ser revisado.
//
// RASCUNHO, e não publicação — a diferença é tudo:
//   * `publicado_em: null` ⇒ a página PÚBLICA não muda (ela filtra por
//     `publicado_em not null`), então o bloco "Notas ao advogado — não
//     publicar" não vai ao ar;
//   * `documentosPendentes` só olha versão publicada ⇒ NINGUÉM é empurrado
//     para `/aceite`;
//   * a tela do admin mostra o rascunho (`page.tsx`: `atual = rascunho ??
//     publicada`) ⇒ é o rascunho que os botões exportam. Que é o objetivo.
//
// Publicar continua sendo decisão separada, feita na tela, DEPOIS que o texto
// voltar revisado. Este script nunca publica.
//
//   node scripts/carregar-rascunho-legal.mjs          → só MOSTRA
//   node scripts/carregar-rascunho-legal.mjs --aplicar → grava o rascunho
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const APLICAR = process.argv.includes('--aplicar');
const ENV_PATH = new URL('../.env.local', import.meta.url);
const DOCS_DIR = new URL('../../docs/legal/', import.meta.url);
const REF = 'llykzqnugdpojwnlontj';
const VERSAO = '1.1';

const DOCUMENTOS = [
  { tipo: 'privacidade', arquivo: 'politica-de-privacidade-v1.md' },
  { tipo: 'termos', arquivo: 'termos-de-uso-v1.md' },
];

function env(key) {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith(key + '='));
  if (!line) throw new Error(`${key} não encontrado em .env.local`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

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
    try { await client.connect(); console.log(`[conectado] ${c.host}`); return client; }
    catch (e) { lastErr = e; try { await client.end(); } catch {} }
  }
  throw lastErr;
}

(async () => {
  console.log(APLICAR ? '[modo] APLICAR — grava rascunho' : '[modo] PRÉVIA — nada será gravado');
  const client = await connect(env('SUPABASE_PASSWORD'));
  try {
    for (const doc of DOCUMENTOS) {
      const conteudo = fs.readFileSync(new URL(doc.arquivo, DOCS_DIR), 'utf8');
      const temWhatsapp = conteudo.includes('WhatsApp');
      const temNotas = conteudo.includes('Notas ao advogado');

      const { rows: atuais } = await client.query(
        `SELECT versao, publicado_em IS NOT NULL AS publicado, length(conteudo_md) AS chars
           FROM documento_versoes WHERE tipo = $1 ORDER BY versao`, [doc.tipo],
      );

      console.log(`\n[${doc.tipo}] ${path.basename(doc.arquivo)} — ${conteudo.length} chars`
        + ` | menciona WhatsApp: ${temWhatsapp} | tem notas ao advogado: ${temNotas}`);
      for (const a of atuais) {
        console.log(`    no banco hoje: v${a.versao} (${a.publicado ? 'publicada' : 'rascunho'}, ${a.chars} chars)`);
      }

      if (!APLICAR) continue;

      // ⚠️ A GUARDA: só toca em linha NÃO publicada. Se a v1.1 já tivesse sido
      // publicada, sobrescrevê-la trocaria por baixo o texto que alguém já
      // aceitou — o mesmo risco que a tela avisa antes de deixar salvar.
      const { rowCount } = await client.query(
        `INSERT INTO documento_versoes (tipo, versao, conteudo_md, publicado_em)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (tipo, versao) DO UPDATE
           SET conteudo_md = EXCLUDED.conteudo_md
         WHERE documento_versoes.publicado_em IS NULL`,
        [doc.tipo, VERSAO, conteudo],
      );
      console.log(rowCount > 0
        ? `    [OK] v${VERSAO} gravada como RASCUNHO (não publicada).`
        : `    [PULADO] v${VERSAO} já existe e está PUBLICADA — não sobrescrevi.`);
    }
    if (!APLICAR) console.log('\n[prévia] rode com --aplicar para gravar.');
    else console.log('\n[fim] Rascunhos gravados. NADA foi publicado; ninguém vai para /aceite.');
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
