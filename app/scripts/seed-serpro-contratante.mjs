/**
 * Seed (manual) do contratante SERPRO na tabela singleton serpro_contratante.
 * Lê o PFX + senha do contratante, cifra com CERT_ENC_KEY (envelope) e faz upsert
 * via service_role. Rodar 1× pelo admin. NÃO versiona segredos.
 *
 * Uso:
 *   node scripts/seed-serpro-contratante.mjs <caminho.pfx> <senha>
 * (defaults: PIPER em docs/n8n, senha_me de senha.json — só p/ ambiente local)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const PFX = process.argv[2] || path.join(ROOT, 'docs/n8n/PIPER AUTOMACOES E INTEGRACOES LTDA 2026-2027 (123456).pfx');
let SENHA = process.argv[3];
if (!SENHA) {
  const s = fs.readFileSync(path.join(ROOT, 'docs/n8n/senha.json'), 'utf8');
  SENHA = String(JSON.parse(s).senha_me);
}

// envelope AES-256-GCM compatível com src/lib/crypto/envelope.ts (iv|tag|ct).
function encryptBlob(plaintext) {
  const keyB64 = process.env.CERT_ENC_KEY;
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('CERT_ENC_KEY deve decodificar p/ 32 bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function certMeta(pfxBuf, senha) {
  const der = forge.util.createBuffer(pfxBuf.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);
  const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
  const cn = cert.subject.getField('CN').value;
  return {
    cnpj: cn.replace(/\D+/g, '').slice(-14),
    nome: cn.replace(/:\d+\s*$/, '').trim(),
    notAfter: cert.validity.notAfter.toISOString(),
    subjectCn: cn,
  };
}

async function main() {
  const pfxBuf = fs.readFileSync(PFX);
  const meta = certMeta(pfxBuf, SENHA);
  console.log('Contratante:', meta.cnpj, '—', meta.nome, '| validade', meta.notAfter);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const row = {
    cnpj: meta.cnpj,
    nome: meta.nome,
    cert_pfx_enc: encryptBlob(pfxBuf).toString('base64'),
    cert_password_enc: encryptBlob(Buffer.from(SENHA, 'utf8')).toString('base64'),
    cert_not_after: meta.notAfter,
    cert_subject_cn: meta.subjectCn,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase.from('serpro_contratante').select('id').limit(1).maybeSingle();
  const res = existing
    ? await supabase.from('serpro_contratante').update(row).eq('id', existing.id)
    : await supabase.from('serpro_contratante').insert(row);
  if (res.error) throw new Error(res.error.message);
  console.log('✅ contratante', existing ? 'atualizado' : 'inserido', 'no singleton.');
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
