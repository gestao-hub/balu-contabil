import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { parsePkcs12 } from './pkcs12';

// Gera um PFX de teste (3DES — cifra legada, bom proxy do A1 real) com senha conhecida.
function makeP12(password: string, validForDays = 365): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const now = Date.now();
  cert.validity.notBefore = new Date(now - 86_400_000);
  cert.validity.notAfter = new Date(now + validForDays * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'EMPRESA TESTE LTDA:12345678000159' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

describe('parsePkcs12', () => {
  it('extrai key+cert PEM e metadados com a senha correta', () => {
    const pfx = makeP12('segredo');
    const m = parsePkcs12(pfx, 'segredo');
    expect(m.keyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(m.certPem).toContain('BEGIN CERTIFICATE');
    expect(m.subjectCN).toBe('EMPRESA TESTE LTDA:12345678000159');
    expect(m.cnpj).toBe('12345678000159');
    expect(new Date(m.notAfter).getTime()).toBeGreaterThan(Date.now());
    expect(m.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lança com senha incorreta', () => {
    const pfx = makeP12('certo');
    expect(() => parsePkcs12(pfx, 'errado')).toThrow();
  });

  it('expõe notAfter no passado para cert expirado', () => {
    const pfx = makeP12('s', -10); // expirou há 10 dias
    const m = parsePkcs12(pfx, 's');
    expect(new Date(m.notAfter).getTime()).toBeLessThan(Date.now());
  });
});
