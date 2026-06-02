/**
 * Smoke de PRODUÇÃO — APENAS CONSULTA (read-only, não emite/declara nada).
 *
 * Modelo correto: contratante = PIPER (cert + dono da assinatura Serpro),
 * contribuinte = AL PISCINAS (CNPJ 10358425000120).
 *
 * Fluxo:
 *   1. Auth mTLS no autenticacao.sapi.serpro.gov.br/authenticate com o cert PIPER
 *      (pfx + passphrase = senha_me do senha.json), role-type TERCEIROS.
 *   2. Extrai o CNPJ da PIPER do próprio cert (node-forge).
 *   3. POST .../integra-contador/v1/Consultar  (PGDASD / CONSDECLARACAO13, anoCalendario 2025).
 *
 * Sem efeito colateral: Consultar é leitura. NÃO chama Emitir/Declarar.
 * Uso: node scripts/test-serpro-consulta-prod-al-piscinas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..'); // repo root (balu/)

// ── .env.local ──────────────────────────────────────────────
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const CK = process.env.SERPRO_CONSUMER_KEY;
const CS = process.env.SERPRO_CONSUMER_SECRET;
if (!CK || !CS) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET ausentes no .env.local');

// ── cert PIPER (contratante) + senha (senha_me, 2º item) ────
const PFX_PATH = path.join(ROOT, 'docs/n8n/PIPER AUTOMACOES E INTEGRACOES LTDA 2026-2027 (123456).pfx');
const pfx = fs.readFileSync(PFX_PATH);
// lê senha_me como STRING crua (preserva zero à esquerda; no JSON vem como número)
const senhaRaw = fs.readFileSync(path.join(ROOT, 'docs/n8n/senha.json'), 'utf8');
const m = senhaRaw.match(/"senha_me"\s*:\s*"?([0-9A-Za-z._-]+)"?/);
if (!m) throw new Error('não achei senha_me no senha.json');
const PASSPHRASE = m[1];

const CONTRIBUINTE = '10358425000120'; // AL PISCINAS LTDA

// ── CNPJ da PIPER a partir do cert ──────────────────────────
function cnpjFromPfx(pfxBuf, pass) {
  const der = forge.util.createBuffer(pfxBuf.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), pass);
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = bags[forge.pki.oids.certBag] || [];
  for (const b of certs) {
    const cn = b.cert?.subject?.getField('CN')?.value || '';
    const digits = cn.replace(/\D+/g, '');
    if (digits.length >= 14) return digits.slice(-14); // e-CNPJ: "RAZAO:CNPJ"
  }
  throw new Error('CNPJ não encontrado no CN do certificado');
}

function mtls(host, pathName, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path: pathName, method: 'POST', pfx, passphrase: PASSPHRASE,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); },
    );
    req.setTimeout(20_000, () => req.destroy(new Error('timeout 20s')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  const contratante = cnpjFromPfx(pfx, PASSPHRASE);
  console.log('Contratante (PIPER) CNPJ:', contratante);
  console.log('Contribuinte (AL PISCINAS):', CONTRIBUINTE);

  // 1) auth mTLS
  console.log('\n1/2 Auth mTLS /authenticate (role-type TERCEIROS)…');
  const basic = 'Basic ' + Buffer.from(`${CK}:${CS}`).toString('base64');
  const auth = await mtls('autenticacao.sapi.serpro.gov.br', '/authenticate',
    { Authorization: basic, 'role-type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded' },
    'grant_type=client_credentials');
  console.log('   → HTTP', auth.status);
  if (auth.status >= 400) { console.error('   ❌ auth falhou:', auth.body.slice(0, 600)); process.exit(1); }
  const aj = JSON.parse(auth.body);
  const accessToken = aj.access_token, jwt = aj.jwt_token;
  console.log('   access_token:', String(accessToken).slice(0, 24), '…  jwt_token:', String(jwt).slice(0, 24), '…');

  // 2) Consultar (read-only) PGDASD / CONSDECLARACAO13
  console.log('\n2/2 POST /integra-contador/v1/Consultar (PGDASD / CONSDECLARACAO13, anoCalendario 2025)…');
  const envelope = {
    contratante:      { numero: contratante, tipo: 2 },
    autorPedidoDados: { numero: contratante, tipo: 2 },
    contribuinte:     { numero: CONTRIBUINTE, tipo: 2 },
    pedidoDados: { idSistema: 'PGDASD', idServico: 'CONSDECLARACAO13', versaoSistema: '1.0',
                   dados: JSON.stringify({ anoCalendario: '2025' }) },
  };
  const cons = await mtls('gateway.apiserpro.serpro.gov.br', '/integra-contador/v1/Consultar',
    { Authorization: `Bearer ${accessToken}`, jwt_token: jwt, 'Content-Type': 'application/json' },
    JSON.stringify(envelope));
  console.log('   → HTTP', cons.status);
  console.log('\nResposta Serpro:\n' + cons.body.slice(0, 3000));
}

main().catch((e) => { console.error('\n❌ ERRO:', e instanceof Error ? e.message : e); process.exit(1); });
