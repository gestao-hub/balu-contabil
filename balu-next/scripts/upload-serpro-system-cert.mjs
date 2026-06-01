/**
 * Parseia o cert da M.E. Integrações (contratante Serpro),
 * cifra com CERT_ENC_KEY e sobe em company-certificates/system/serpro-contratante.enc
 *
 * Uso: node scripts/upload-serpro-system-cert.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import forge from 'node-forge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── env ──────────────────────────────────────────────────────────────────
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

// ─── config ───────────────────────────────────────────────────────────────
const PFX_PATH    = '/home/allan/Projetos/claude/balu/docs/n8n/M. E. INTEGRACOES E AUTOMACOES EMPRESARIAIS LTDA 2025-2026 (123456) (2).pfx';
const SENHA       = '123456';
const BUCKET      = 'company-certificates';
const STORAGE_KEY = 'system/serpro-contratante.enc';

// ─── parse PFX ────────────────────────────────────────────────────────────
console.log('1/4 Lendo e parseando PFX…');
const pfxBuf = fs.readFileSync(PFX_PATH);
const der    = forge.util.createBuffer(pfxBuf.toString('binary'));
const asn1   = forge.asn1.fromDer(der);
const p12    = forge.pkcs12.pkcs12FromAsn1(asn1, SENHA);

// chave privada
let privateKey;
for (const oid of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
  const bags = p12.getBags({ bagType: oid })[oid] ?? [];
  if (bags[0]?.key) { privateKey = bags[0].key; break; }
}
if (!privateKey) throw new Error('Chave privada não encontrada no PFX.');

// certificados
const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
const certs    = certBags.map(b => b.cert).filter(Boolean);
if (!certs.length) throw new Error('Nenhum certificado encontrado no PFX.');

const leaf = certs.find(c => {
  const pub = c.publicKey;
  return pub?.n != null && pub.n.equals(privateKey.n);
}) ?? certs[0];

const keyPem   = forge.pki.privateKeyToPem(privateKey);
const certPem  = forge.pki.certificateToPem(leaf);
const chainPem = certs.filter(c => c !== leaf).map(c => forge.pki.certificateToPem(c)).join('');

const cn       = leaf.subject.getField('CN')?.value ?? '';
const cnpjMatch = cn.match(/(\d{14})(?:\D|$)/);
const cnpj     = cnpjMatch ? cnpjMatch[1] : null;

console.log('   CN        :', cn);
console.log('   CNPJ      :', cnpj ?? '(não encontrado no CN)');
console.log('   Válido até:', leaf.validity.notAfter.toISOString().slice(0, 10));

// ─── cifrar ───────────────────────────────────────────────────────────────
console.log('2/4 Cifrando AES-256-GCM…');
const encKeyB64 = process.env.CERT_ENC_KEY;
if (!encKeyB64) throw new Error('CERT_ENC_KEY ausente');
const encKey  = Buffer.from(encKeyB64, 'base64');
if (encKey.length !== 32) throw new Error('CERT_ENC_KEY deve ter 32 bytes');

const iv      = randomBytes(12);
const cipher  = createCipheriv('aes-256-gcm', encKey, iv);
const payload = Buffer.from(JSON.stringify({ keyPem, certPem, chainPem }), 'utf8');
const ct      = Buffer.concat([cipher.update(payload), cipher.final()]);
const blob    = Buffer.concat([iv, cipher.getAuthTag(), ct]);
console.log(`   blob: ${blob.length} bytes`);

// ─── upload ───────────────────────────────────────────────────────────────
console.log(`3/4 Subindo para ${BUCKET}/${STORAGE_KEY}…`);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error } = await admin.storage.from(BUCKET).upload(STORAGE_KEY, blob, {
  contentType: 'application/octet-stream',
  upsert: true,
});
if (error) throw new Error(`Upload falhou: ${error.message}`);

// ─── verificar ────────────────────────────────────────────────────────────
console.log('4/4 Verificando…');
const { data: list } = await admin.storage.from(BUCKET).list('system');
console.log('   system/:', list?.map(f => f.name).join(', '));

console.log('\n✅ Cert do sistema salvo com sucesso!');
console.log(`   Bucket : ${BUCKET}`);
console.log(`   Path   : ${STORAGE_KEY}`);
console.log(`   CNPJ   : ${cnpj}`);
console.log('\n→ Use este CNPJ como "contratante" nas chamadas Serpro.');
