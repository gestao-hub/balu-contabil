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
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
