// Smoke Serpro — espelha src/lib/clients/serpro.ts (bearer + Emitir trial).
// Lê .env.local, NÃO imprime segredos. Uso: node scripts/serpro-smoke.mjs
import { readFileSync } from 'node:fs';

function loadEnv() {
  const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const env = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';
const TRIAL_BASE = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial';
const EMITIR_URL = `${TRIAL_BASE}/v1/Emitir`;
const CONSULTAR_URL = `${TRIAL_BASE}/v1/Consultar`;

// Decodifica o payload de um JWT (sem validar assinatura) — só pra inspeção.
function decodeJwt(t) {
  try {
    const parts = t.split('.');
    if (parts.length < 2) return null;
    const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(pad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

const env = loadEnv();
const key = env.SERPRO_CONSUMER_KEY;
const secret = env.SERPRO_CONSUMER_SECRET;

console.log('== Serpro smoke ==');
console.log('consumer_key present:', !!key, key ? `(len ${key.length})` : '');
console.log('consumer_secret present:', !!secret, secret ? `(len ${secret.length})` : '');
if (!key || !secret) { console.log('ABORT: credenciais ausentes no .env.local'); process.exit(1); }

const basic = Buffer.from(`${key}:${secret}`).toString('base64');

// --- 1) token ---
console.log('\n[1] POST /token (client_credentials) ...');
let token;
try {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const txt = await r.text();
  console.log('  status:', r.status);
  let j = {}; try { j = JSON.parse(txt); } catch {}
  token = j.access_token;
  console.log('  access_token:', token ? `OK (len ${token.length})` : 'AUSENTE');
  console.log('  expires_in:', j.expires_in ?? '(n/a)', '| scope:', j.scope ?? '(n/a)');
  if (!token) { console.log('  body:', txt.slice(0, 300)); console.log('\nRESULT: token falhou — credenciais INVÁLIDAS (cliente não criou a app, ou key/secret errados).'); process.exit(2); }
  // Inspeciona o JWT: quais produtos/escopos a aplicação tem assinados.
  const jwt = j.jwt_token ? decodeJwt(j.jwt_token) : null;
  if (jwt) {
    const subs = jwt.subscribedAPIs || jwt['http://wso2.org/claims/subscriber'] || jwt.scope || null;
    console.log('  JWT subscriber/aud:', jwt.sub || jwt.aud || '(n/a)');
    console.log('  JWT subscribedAPIs:', subs ? JSON.stringify(subs).slice(0, 300) : '(nenhuma listada)');
  }
} catch (e) {
  console.log('  ERRO de rede:', String(e).slice(0, 200)); process.exit(2);
}

// --- 2) Emitir (PGMEI / GERARDASPDF21) com CNPJ/período demo ---
console.log('\n[2] POST /integra-contador-trial/v1/Emitir (PGMEI GERARDASPDF21, CNPJ demo) ...');
const CNPJ = '00000000000100';
const envelope = {
  contratante: { numero: CNPJ, tipo: 2 },
  autorPedidoDados: { numero: CNPJ, tipo: 2 },
  contribuinte: { numero: CNPJ, tipo: 2 },
  pedidoDados: {
    idSistema: 'PGMEI',
    idServico: 'GERARDASPDF21',
    versaoSistema: '1.0',
    dados: JSON.stringify({ periodoApuracao: '201901' }),
  },
};
try {
  const r = await fetch(EMITIR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope),
  });
  const txt = await r.text();
  console.log('  status:', r.status);
  let j = {}; try { j = JSON.parse(txt); } catch {}
  if (j.code || j.message) console.log('  code:', j.code, '| message:', j.message, '| desc:', (j.description||'').slice(0,120));
  console.log('  body[:400]:', txt.slice(0, 400));

  var emitirStatus = r.status, emitirCode = String(j.code || '');
} catch (e) {
  console.log('  ERRO de rede:', String(e).slice(0, 200)); process.exit(2);
}

// --- 3) Consultar (segundo endpoint) — prova que o 403 não é só da rota /Emitir ---
console.log('\n[3] POST /integra-contador-trial/v1/Consultar (mesmo produto, outra rota) ...');
let consultarStatus, consultarCode = '';
try {
  const r = await fetch(CONSULTAR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope),
  });
  const txt = await r.text();
  let j = {}; try { j = JSON.parse(txt); } catch {}
  consultarStatus = r.status; consultarCode = String(j.code || '');
  console.log('  status:', r.status, '| code:', j.code ?? '(n/a)', '| desc:', (j.description||'').slice(0,100));
} catch (e) {
  console.log('  ERRO de rede:', String(e).slice(0, 200));
}

// --- VEREDITO ---
console.log('\n== VEREDITO ==');
console.log(`  /token     → 200 (credenciais VÁLIDAS: a app existe e autentica)`);
console.log(`  /Emitir    → ${emitirStatus}${emitirCode ? ' ('+emitirCode+')' : ''}`);
console.log(`  /Consultar → ${consultarStatus ?? '?'}${consultarCode ? ' ('+consultarCode+')' : ''}`);
console.log('');
if (emitirStatus === 200) {
  console.log('✅ Emitir OK (200) — assinatura Trial ATIVA. Passo 3 destravável!');
} else if (emitirCode === '900908' && consultarCode === '900908') {
  console.log('❌ CONCLUSIVO: 403 900908 em DUAS rotas do mesmo produto, COM token válido.');
  console.log('   → A app (consumer key) autentica, mas NÃO está inscrita no produto Integra Contador.');
  console.log('   → Causa típica: a ASSINATURA do produto não foi feita/paga no portal Serpro.');
  console.log('   → NÃO é problema de certificado, de código, nem de procuração (Trial nem chega lá).');
} else if (emitirCode === '900908') {
  console.log('❌ 403 900908 no /Emitir — app não inscrita no produto (gap de assinatura).');
} else {
  console.log(`⚠️  status ${emitirStatus} — não é o 900908 conhecido; ver body acima.`);
}
