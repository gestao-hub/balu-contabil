import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { buildTermoXml, signTermoXml } from './serpro-termo';

// Gera um par de chaves + um "certPem" sintético (PEM qualquer) só para exercitar a assinatura.
// XMLDSig aqui não valida a cadeia — só precisamos de uma key RSA e um PEM com corpo base64.
function fakeCertPem(): string {
  const body = Buffer.from('cert-de-teste').toString('base64');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

describe('buildTermoXml', () => {
  const xml = buildTermoXml({
    destinatario: { cnpj: '61061690000183', nome: 'PIPER LTDA' },
    autor: { cnpj: '10358425000120', nome: 'AL PISCINAS LTDA' },
    hoje: new Date('2026-06-03T12:00:00Z'),
  });

  it('põe o contratante como destinatário e a empresa como autor', () => {
    expect(xml).toContain('numero="61061690000183"');
    expect(xml).toContain('papel="contratante"');
    expect(xml).toContain('numero="10358425000120"');
    expect(xml).toContain('papel="autor pedido de dados"');
  });

  it('tem dataAssinatura e vigencia no formato YYYYMMDD', () => {
    expect(xml).toContain('data="20260603"'); // dataAssinatura
    expect(xml).toMatch(/vigencia data="\d{8}"/);
  });
});

describe('signTermoXml', () => {
  it('produz uma assinatura enveloped com X509Certificate', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const xml = buildTermoXml({
      destinatario: { cnpj: '61061690000183', nome: 'PIPER LTDA' },
      autor: { cnpj: '10358425000120', nome: 'AL PISCINAS LTDA' },
      hoje: new Date('2026-06-03T12:00:00Z'),
    });
    const signed = signTermoXml(xml, { keyPem, certPem: fakeCertPem() });
    expect(signed).toMatch(/<(\w+:)?Signature/);
    expect(signed).toContain('<X509Certificate>');
    expect(signed).toContain(Buffer.from('cert-de-teste').toString('base64'));
  });

  it('mantém o elemento termoDeAutorizacao', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const xml = buildTermoXml({
      destinatario: { cnpj: '1', nome: 'A' },
      autor: { cnpj: '2', nome: 'B' },
      hoje: new Date('2026-06-03T12:00:00Z'),
    });
    const signed = signTermoXml(xml, { keyPem, certPem: fakeCertPem() });
    expect(signed).toContain('termoDeAutorizacao');
  });
});
