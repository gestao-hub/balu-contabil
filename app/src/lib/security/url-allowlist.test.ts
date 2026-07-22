import { describe, it, expect } from 'vitest';
import { urlDownloadPermitida } from './url-allowlist';

describe('urlDownloadPermitida', () => {
  it('permite S3 pré-assinado da Focus e a API Focus', () => {
    expect(urlDownloadPermitida('https://focus-nfe-arquivos.s3.amazonaws.com/x.pdf')).toBe(true);
    expect(urlDownloadPermitida('https://api.focusnfe.com.br/v2/x.xml')).toBe(true);
    expect(urlDownloadPermitida('https://homologacao.focusnfe.com.br/v2/x.xml')).toBe(true);
  });
  it('bloqueia hosts fora da allowlist', () => {
    expect(urlDownloadPermitida('https://evil.com/x')).toBe(false);
  });
  it('bloqueia alvos internos e metadata', () => {
    expect(urlDownloadPermitida('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(urlDownloadPermitida('http://127.0.0.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://10.0.0.5/x')).toBe(false);
    expect(urlDownloadPermitida('http://192.168.1.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://localhost/x')).toBe(false);
  });
  it('bloqueia esquemas não-http', () => {
    expect(urlDownloadPermitida('file:///etc/passwd')).toBe(false);
    expect(urlDownloadPermitida('lixo')).toBe(false);
  });
});
