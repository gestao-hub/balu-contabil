// @custom — parse de certificado A1 (.pfx/.p12) via node-forge.
// node-forge lê as cifras PKCS#12 legadas (RC2-40/3DES-SHA1) que o OpenSSL 3 (Node 22) recusa.
// Puro (sem server-only) para ser testável.
import forge from 'node-forge';

export type CertMaterial = {
  keyPem: string;
  certPem: string;
  chainPem: string;       // intermediários concatenados; '' se não houver
  notBefore: string;      // ISO
  notAfter: string;       // ISO
  subjectCN: string;
  cnpj: string | null;    // 14 dígitos quando presente no CN (padrão e-CNPJ "NOME:CNPJ")
  fingerprintSha256: string;
};

function findPrivateKey(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.rsa.PrivateKey {
  for (const oid of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType: oid })[oid] ?? [];
    const key = bags[0]?.key;
    if (key) return key;
  }
  throw new Error('Chave privada não encontrada no certificado.');
}

export function parsePkcs12(pfx: Buffer, senha: string): CertMaterial {
  const der = forge.util.createBuffer(pfx.toString('binary'));
  const asn1 = forge.asn1.fromDer(der);
  // Senha incorreta lança "PKCS#12 MAC could not be verified. Invalid password?".
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const privateKey = findPrivateKey(p12);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (certBags.length === 0 || !certBags[0].cert) {
    throw new Error('Certificado não encontrado no arquivo.');
  }
  const leaf = certBags[0].cert;

  const keyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(leaf);
  const chainPem = certBags
    .slice(1)
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : ''))
    .join('');

  const cn = (leaf.subject.getField('CN')?.value as string | undefined) ?? '';
  const cnpjMatch = cn.match(/(\d{14})\s*$/);

  const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const md = forge.md.sha256.create();
  md.update(derCert);

  return {
    keyPem,
    certPem,
    chainPem,
    notBefore: leaf.validity.notBefore.toISOString(),
    notAfter: leaf.validity.notAfter.toISOString(),
    subjectCN: cn,
    cnpj: cnpjMatch ? cnpjMatch[1] : null,
    fingerprintSha256: md.digest().toHex(),
  };
}
