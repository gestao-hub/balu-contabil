/**
 * Smoke real: gera DAS-MEI via Serpro Integra Contador (Trial).
 * Usa inputs de demonstração fixos do Trial:
 *   CNPJ: 00000000000100  |  período: 201901
 *
 * Não exige empresa MEI no banco — chama o Serpro diretamente.
 *
 * Uso:
 *   node scripts/test-serpro-das-trial.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const TRIAL_BASE  = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial';
const TOKEN_URL   = 'https://gateway.apiserpro.serpro.gov.br/token';
const DEMO_CNPJ   = '00000000000100';
const DEMO_PERIOD = '201901';

// ─── 1. Obter bearer token ────────────────────────────────────────────────
async function getToken() {
  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET ausentes');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token → ${res.status}: ${await res.text()}`);
  const j = await res.json();
  console.log(`   token obtido (expires_in: ${j.expires_in}s)`);
  return j.access_token;
}

// ─── 2. Montar envelope PGMEI ─────────────────────────────────────────────
function buildEnvelope(cnpj, periodo) {
  return {
    contratante:      { numero: cnpj, tipo: 2 },
    autorPedidoDados: { numero: cnpj, tipo: 2 },
    contribuinte:     { numero: cnpj, tipo: 2 },
    pedidoDados: {
      idSistema:      'PGMEI',
      idServico:      'GERARDASPDF21',
      versaoSistema:  '1.0',
      dados: JSON.stringify({ periodoApuracao: periodo }),
    },
  };
}

// ─── 3. Parsear resposta do Serpro ────────────────────────────────────────
function parseDas(raw) {
  const outer = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // outer = { status, mensagens, dados: "<string json>" }
  const dados = typeof outer.dados === 'string' ? JSON.parse(outer.dados) : outer.dados;
  const item = Array.isArray(dados) ? dados[0] : dados;
  const det  = item?.detalhamento?.[0] ?? item;

  const dataVenc = String(det?.dataVencimento ?? '');
  const isoVenc  = dataVenc.length === 8
    ? `${dataVenc.slice(0,4)}-${dataVenc.slice(4,6)}-${dataVenc.slice(6,8)}`
    : dataVenc;

  return {
    cnpj:            item?.cnpjCompleto ?? DEMO_CNPJ,
    numeroDocumento: det?.numeroDocumento ?? null,
    dataVencimento:  isoVenc,
    valores:         det?.valores ?? {},
    barras:          det?.codigoDeBarras ?? [],
    temPdf:          !!item?.pdf,
    pdfBase64:       item?.pdf ?? null,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('1/3 Obtendo token Bearer (Trial)…');
  const token = await getToken();

  console.log(`2/3 Chamando POST ${TRIAL_BASE}/v1/Emitir (PGMEI/GERARDASPDF21)…`);
  const envelope = buildEnvelope(DEMO_CNPJ, DEMO_PERIOD);
  console.log('    envelope:', JSON.stringify(envelope, null, 2));

  const res = await fetch(`${TRIAL_BASE}/v1/Emitir`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(envelope),
  });

  const rawText = await res.text();
  console.log(`\n→ HTTP ${res.status}`);

  if (!res.ok) {
    console.error('❌ Erro Serpro:', rawText.slice(0, 500));
    process.exit(1);
  }

  console.log('\n3/3 Parseando resposta…');
  const rawJson = JSON.parse(rawText);
  console.log('\nRaw status:', rawJson.status);
  console.log('Mensagens :', JSON.stringify(rawJson.mensagens));

  const das = parseDas(rawJson);

  console.log('\n✅ DAS gerado com sucesso!\n');
  console.log('  CNPJ           :', das.cnpj);
  console.log('  Número doc     :', das.numeroDocumento);
  console.log('  Vencimento     :', das.dataVencimento);
  console.log('  Principal      :', das.valores.principal);
  console.log('  Multa          :', das.valores.multa);
  console.log('  Juros          :', das.valores.juros);
  console.log('  Total          :', das.valores.total);
  console.log('  Código barras  :', das.barras.join(' | '));
  console.log('  PDF (base64)   :', das.temPdf ? `SIM (${das.pdfBase64.length} chars)` : 'NÃO');

  if (das.pdfBase64) {
    const outPath = path.resolve(__dirname, '../das-trial.pdf');
    fs.writeFileSync(outPath, Buffer.from(das.pdfBase64, 'base64'));
    console.log(`\n  PDF salvo em: ${outPath}`);
  }
}

main().catch((err) => {
  console.error('\n❌ ERRO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
