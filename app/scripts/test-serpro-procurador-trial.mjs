/**
 * SPIKE — fluxo "Autenticar Procurador" (Termo de Autorização) apontado para o TRIAL.
 * Variante de test-serpro-procurador-al-piscinas.mjs: mesmo fluxo (mTLS PIPER + Termo XML
 * assinado pela AL PISCINAS), mas as operações batem em `integra-contador-trial/v1/...`.
 *
 * Objetivo: verificar se o fluxo procurador (XML) passa no Trial, ou se ainda esbarra no
 * 403 900908 (subscription do produto Trial não ativa — bloqueio anterior à operação).
 *
 * O Termo XML é gerado FRESCO a cada execução (dataAssinatura=hoje, vigencia=hoje+365) e o
 * autenticar_procurador_token só vale até a meia-noite do dia seguinte → re-rodar regenera tudo.
 *
 * Spec: docs/investigations/SERPRO-INVESTIGACAO.md (rodada 6).
 * Uso: node scripts/test-serpro-procurador-trial.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}
const CK = process.env.SERPRO_CONSUMER_KEY, CS = process.env.SERPRO_CONSUMER_SECRET;
if (!CK || !CS) throw new Error('SERPRO_CONSUMER_KEY/SECRET ausentes');

// senhas: senha (1º = AL PISCINAS), senha_me (2º = PIPER) — lidas como string crua
const senhaTxt = fs.readFileSync(path.join(ROOT, 'docs/n8n/senha.json'), 'utf8');
const SENHA_PISCINAS = senhaTxt.match(/"senha"\s*:\s*"?([0-9A-Za-z._-]+)"?/)[1];
const SENHA_PIPER    = senhaTxt.match(/"senha_me"\s*:\s*"?([0-9A-Za-z._-]+)"?/)[1];

const PFX_PIPER    = path.join(ROOT, 'docs/n8n/PIPER AUTOMACOES E INTEGRACOES LTDA 2026-2027 (123456).pfx');
const PFX_PISCINAS = path.join(ROOT, 'docs/n8n/AL PISCINAS LTDA_2026 2027.pfx');
const CONTRIBUINTE = '10358425000120';

function loadPfx(file, pass) {
  const der = forge.util.createBuffer(fs.readFileSync(file).toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), pass);
  let key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
  if (!key) key = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]?.key;
  const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
  const cn = cert.subject.getField('CN').value;
  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(cert),
    certDerB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    cnpj: cn.replace(/\D+/g, '').slice(-14),
    nome: cn.replace(/:\d+\s*$/, '').trim(),
    pfx: fs.readFileSync(file),
  };
}

function req({ host, path: p, headers, body, pfx, passphrase }) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host, path: p, method: 'POST', pfx, passphrase,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); });
    r.setTimeout(25_000, () => r.destroy(new Error('timeout')));
    r.on('error', reject); r.write(body); r.end();
  });
}

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

function buildTermo(dest, autor) {
  const hoje = new Date(); const vig = new Date(); vig.setDate(vig.getDate() + 365);
  const TERMO = 'Autorizo a empresa CONTRATANTE, identificada neste termo de autorização como DESTINATÁRIO, a executar as requisições dos serviços web disponibilizados pela API INTEGRA CONTADOR, onde terei o papel de AUTOR PEDIDO DE DADOS no corpo da mensagem enviada na requisição do serviço web. Esse termo de autorização está assinado digitalmente com o certificado digital do PROCURADOR ou OUTORGADO DO CONTRIBUINTE responsável, identificado como AUTOR DO PEDIDO DE DADOS.';
  const AVISO = 'O acesso a estas informações foi autorizado pelo próprio PROCURADOR ou OUTORGADO DO CONTRIBUINTE, responsável pela informação, via assinatura digital. É dever do destinatário da autorização e consumidor deste acesso observar a adoção de base legal para o tratamento dos dados recebidos conforme artigos 7º ou 11º da LGPD (Lei n.º 13.709, de 14 de agosto de 2018), aos direitos do titular dos dados (art. 9º, 17 e 18, da LGPD) e aos princípios que norteiam todos os tratamentos de dados no Brasil (art. 6º, da LGPD).';
  const FINAL = 'A finalidade única e exclusiva desse TERMO DE AUTORIZAÇÃO, é garantir que o CONTRATANTE apresente a API INTEGRA CONTADOR esse consentimento do PROCURADOR ou OUTORGADO DO CONTRIBUINTE assinado digitalmente, para que possa realizar as requisições dos serviços web da API INTEGRA CONTADOR em nome do AUTOR PEDIDO DE DADOS (PROCURADOR ou OUTORGADO DO CONTRIBUINTE).';
  return `<?xml version="1.0" encoding="UTF-8"?><termoDeAutorizacao><dados><sistema id="API Integra Contador"/><termo texto="${TERMO}"/><avisoLegal texto="${AVISO}"/><finalidade texto="${FINAL}"/><dataAssinatura data="${ymd(hoje)}"/><vigencia data="${ymd(vig)}"/><destinatario numero="${dest.cnpj}" nome="${dest.nome}" tipo="PJ" papel="contratante"/><assinadoPor numero="${autor.cnpj}" nome="${autor.nome}" tipo="PJ" papel="autor pedido de dados"/></dados></termoDeAutorizacao>`;
}

function signTermo(xml, signer) {
  const sig = new SignedXml({
    privateKey: signer.keyPem,
    publicCert: signer.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='termoDeAutorizacao']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: '', isEmptyUri: true,
  });
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${signer.certDerB64}</X509Certificate></X509Data>`;
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='termoDeAutorizacao']", action: 'append' } });
  return sig.getSignedXml();
}

async function main() {
  const piper = loadPfx(PFX_PIPER, SENHA_PIPER);
  const piscinas = loadPfx(PFX_PISCINAS, SENHA_PISCINAS);
  console.log('Contratante/destinatário (PIPER):', piper.cnpj, '—', piper.nome);
  console.log('Autor/assinante (AL PISCINAS)  :', piscinas.cnpj, '—', piscinas.nome);

  console.log('\n1/4 mTLS /authenticate (cert PIPER)…');
  const auth = await req({ host: 'autenticacao.sapi.serpro.gov.br', path: '/authenticate',
    headers: { Authorization: 'Basic ' + Buffer.from(`${CK}:${CS}`).toString('base64'), 'role-type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', pfx: piper.pfx, passphrase: SENHA_PIPER });
  console.log('   → HTTP', auth.status);
  if (auth.status >= 400) { console.error(auth.body.slice(0, 500)); process.exit(1); }
  const aj = JSON.parse(auth.body); const accessToken = aj.access_token, jwt = aj.jwt_token;
  console.log('   tokens OK');

  console.log('\n2/4 Montando + assinando Termo (cert AL PISCINAS)…');
  const xml = buildTermo(piper, piscinas);
  const signed = signTermo(xml, piscinas);
  const xmlB64 = Buffer.from(signed, 'utf8').toString('base64');
  console.log('   XML assinado:', signed.length, 'chars; tem <Signature>:', signed.includes('<Signature') || signed.includes(':Signature'));

  console.log('\n3/4 POST /Apoiar (AUTENTICAPROCURADOR/ENVIOXMLASSINADO81)…');
  const apoiarBody = JSON.stringify({
    contratante: { numero: piper.cnpj, tipo: 2 },
    autorPedidoDados: { numero: piscinas.cnpj, tipo: 2 },
    contribuinte: { numero: piscinas.cnpj, tipo: 2 },
    pedidoDados: { idSistema: 'AUTENTICAPROCURADOR', idServico: 'ENVIOXMLASSINADO81', versaoSistema: '1.0', dados: JSON.stringify({ xml: xmlB64 }) },
  });
  const apoiar = await req({ host: 'gateway.apiserpro.serpro.gov.br', path: '/integra-contador-trial/v1/Apoiar',
    headers: { Authorization: `Bearer ${accessToken}`, jwt_token: jwt, 'Content-Type': 'application/json' },
    body: apoiarBody, pfx: piper.pfx, passphrase: SENHA_PIPER });
  console.log('   → HTTP', apoiar.status);
  console.log('   ETag:', apoiar.headers.etag || '(nenhum)');
  console.log('   body:', apoiar.body.slice(0, 1200));

  // extrai token de dados.autenticar_procurador_token (200) ou ETag (304)
  let procToken = null;
  try { const j = JSON.parse(apoiar.body); const d = j.dados ? JSON.parse(j.dados) : {}; procToken = d.autenticar_procurador_token || j.autenticarProcuradorToken || null; } catch {}
  if (!procToken && apoiar.headers.etag) { const m = String(apoiar.headers.etag).match(/autenticar_procurador_token:([^"]+)/); if (m) procToken = m[1]; }
  if (!procToken) { console.log('\n⚠️ sem token_procurador — parar aqui (analisar resposta acima).'); return; }
  console.log('   ✅ autenticar_procurador_token:', procToken.slice(0, 24), '…');

  console.log('\n4/4 POST /Consultar (PGDASD/CONSDECLARACAO13) com token_procurador…');
  const env = {
    contratante: { numero: piper.cnpj, tipo: 2 },
    autorPedidoDados: { numero: piscinas.cnpj, tipo: 2 },
    contribuinte: { numero: CONTRIBUINTE, tipo: 2 },
    pedidoDados: { idSistema: 'PGDASD', idServico: 'CONSDECLARACAO13', versaoSistema: '1.0', dados: JSON.stringify({ anoCalendario: '2025' }) },
  };
  const cons = await req({ host: 'gateway.apiserpro.serpro.gov.br', path: '/integra-contador-trial/v1/Consultar',
    headers: { Authorization: `Bearer ${accessToken}`, jwt_token: jwt, autenticar_procurador_token: procToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(env), pfx: piper.pfx, passphrase: SENHA_PIPER });
  console.log('   → HTTP', cons.status);
  console.log('\nResposta Consultar:\n' + cons.body.slice(0, 3000));
}
main().catch((e) => { console.error('\n❌ ERRO:', e?.stack || e); process.exit(1); });
