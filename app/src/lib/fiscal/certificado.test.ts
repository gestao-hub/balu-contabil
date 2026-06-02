import { describe, it, expect } from 'vitest';
import { validateCertificadoUpload } from './certificado';

const ok = { name: 'cert.pfx', size: 5000, senha: 'segredo' };

describe('validateCertificadoUpload', () => {
  it('aceita .pfx e .p12 válidos com senha', () => {
    expect(validateCertificadoUpload(ok).ok).toBe(true);
    expect(validateCertificadoUpload({ ...ok, name: 'CERT.P12' }).ok).toBe(true);
  });
  it('rejeita extensão inválida', () => {
    expect(validateCertificadoUpload({ ...ok, name: 'cert.txt' }).ok).toBe(false);
  });
  it('rejeita size 0 ou acima de 1MB', () => {
    expect(validateCertificadoUpload({ ...ok, size: 0 }).ok).toBe(false);
    expect(validateCertificadoUpload({ ...ok, size: 2_000_000 }).ok).toBe(false);
  });
  it('rejeita senha vazia', () => {
    expect(validateCertificadoUpload({ ...ok, senha: '' }).ok).toBe(false);
    expect(validateCertificadoUpload({ ...ok, senha: '   ' }).ok).toBe(false);
  });
});
