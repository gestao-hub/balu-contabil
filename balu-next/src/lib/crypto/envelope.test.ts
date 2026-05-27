import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { encryptBlob, decryptBlob } from './envelope';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

beforeAll(() => {
  process.env.CERT_ENC_KEY = KEY_B64;
});
afterEach(() => {
  process.env.CERT_ENC_KEY = KEY_B64; // restaura entre casos que mexem no env
});

describe('envelope AES-256-GCM', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = Buffer.from('material de chave PEM', 'utf8');
    const back = decryptBlob(encryptBlob(plain));
    expect(back.equals(plain)).toBe(true);
  });

  it('detecta adulteração (GCM authTag)', () => {
    const blob = encryptBlob(Buffer.from('abc'));
    blob[blob.length - 1] ^= 0xff; // corrompe o ciphertext
    expect(() => decryptBlob(blob)).toThrow();
  });

  it('lança se CERT_ENC_KEY ausente', () => {
    delete process.env.CERT_ENC_KEY;
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/CERT_ENC_KEY/);
  });

  it('lança se a chave não decodifica para 32 bytes', () => {
    process.env.CERT_ENC_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/32 bytes/);
  });

  it('lança para blob curto demais (corrompido)', () => {
    expect(() => decryptBlob(Buffer.alloc(10))).toThrow(/curto/);
  });
});
