import { describe, it, expect } from 'vitest';
import { urlDownloadPermitida } from './url-allowlist';

describe('urlDownloadPermitida', () => {
  it('permite S3 pré-assinado da Focus e a API Focus', () => {
    expect(urlDownloadPermitida('https://focusnfe.s3.sa-east-1.amazonaws.com/x.pdf')).toBe(true);
    expect(urlDownloadPermitida('https://focus-nfe-arquivos.s3.amazonaws.com/x.pdf')).toBe(true);
    expect(urlDownloadPermitida('https://api.focusnfe.com.br/v2/x.xml')).toBe(true);
    expect(urlDownloadPermitida('https://homologacao.focusnfe.com.br/v2/x.xml')).toBe(true);
  });
  it('bloqueia hosts fora da allowlist e serviços AWS não-S3', () => {
    expect(urlDownloadPermitida('https://evil.com/x')).toBe(false);
    expect(urlDownloadPermitida('https://abc.lambda-url.us-east-1.on.aws/x')).toBe(false);
    expect(urlDownloadPermitida('https://abc.execute-api.us-east-1.amazonaws.com/x')).toBe(false);
    expect(urlDownloadPermitida('https://abc.elb.us-east-1.amazonaws.com/x')).toBe(false);
  });
  // PIN (nao red-first: a implementacao ja estava certa). A comparacao de host
  // tem de ser IGUALDADE ou SUFIXO COM PONTO. Trocar `endsWith('.focusnfe.com.br')`
  // por `includes('focusnfe.com.br')` ou `startsWith('api.focusnfe.com.br')`
  // passa pelo typecheck e liberaria exatamente o host que o SSRF do route de
  // download montava: `api.focusnfe.com.br.evil.tld`.
  it('bloqueia dominio irmao que so CONTEM o host da Focus', () => {
    expect(urlDownloadPermitida('https://api.focusnfe.com.br.evil.tld/x')).toBe(false);
    expect(urlDownloadPermitida('https://focusnfe.com.br.evil.tld/x')).toBe(false);
    expect(urlDownloadPermitida('https://evil.tld/api.focusnfe.com.br/x')).toBe(false);
    expect(urlDownloadPermitida('https://naofocusnfe.com.br/x')).toBe(false);
    // userinfo: o host da Focus vira credencial, o host real e o do atacante.
    expect(urlDownloadPermitida('https://api.focusnfe.com.br@evil.tld/x')).toBe(false);
    // idem para o ramo S3.
    expect(urlDownloadPermitida('https://x.s3.amazonaws.com.evil.tld/x')).toBe(false);
  });
  it('bloqueia alvos internos e metadata', () => {
    expect(urlDownloadPermitida('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(urlDownloadPermitida('http://127.0.0.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://10.0.0.5/x')).toBe(false);
    expect(urlDownloadPermitida('http://192.168.1.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://localhost/x')).toBe(false);
    expect(urlDownloadPermitida('http://0.0.0.0/x')).toBe(false);
    expect(urlDownloadPermitida('http://[::1]/x')).toBe(false);
    expect(urlDownloadPermitida('http://[::ffff:169.254.169.254]/x')).toBe(false);
  });
  it('bloqueia esquemas não-http', () => {
    expect(urlDownloadPermitida('file:///etc/passwd')).toBe(false);
    expect(urlDownloadPermitida('lixo')).toBe(false);
  });
});
