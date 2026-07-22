// @custom — cifra em repouso do material de certificado (AES-256-GCM).
// Puro (sem server-only) para ser testável; só lê CERT_ENC_KEY (segredo de server).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const b64 = process.env.CERT_ENC_KEY;
  if (!b64) {
    throw new Error('CERT_ENC_KEY não configurado — cifra de certificado exige chave de 32 bytes (base64).');
  }
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) {
    throw new Error('CERT_ENC_KEY deve decodificar para 32 bytes (AES-256).');
  }
  return k;
}

/** Retorna `iv(12) ∥ authTag(16) ∥ ciphertext`. */
export function encryptBlob(plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBlob(blob: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('decryptBlob: blob curto demais (corrompido ou chave errada).');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

const PREFIXO = 'enc:v1:';

/** Cifra um campo curto (string) para armazenar em repouso. '' passa direto. */
export function cifrarCampo(v: string): string {
  if (!v) return v;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIXO + Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decifra; se não tiver o prefixo (legado em claro), retorna o próprio valor. */
export function decifrarCampo(v: string | null): string | null {
  if (v == null || !v.startsWith(PREFIXO)) return v;
  const buf = Buffer.from(v.slice(PREFIXO.length), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv(ALGO, key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
