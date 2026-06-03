// Termo de Autorização SERPRO (AUTENTICAPROCURADOR/ENVIOXMLASSINADO81).
// Build + assinatura XMLDSig (RSA-SHA256, c14n 1.0 inclusiva). Puro/testável.
// Extraído do spike app/scripts/test-serpro-procurador-al-piscinas.mjs.
import { SignedXml } from 'xml-crypto';

export type TermoParte = { cnpj: string; nome: string };

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

const TERMO =
  'Autorizo a empresa CONTRATANTE, identificada neste termo de autorização como DESTINATÁRIO, a executar as requisições dos serviços web disponibilizados pela API INTEGRA CONTADOR, onde terei o papel de AUTOR PEDIDO DE DADOS no corpo da mensagem enviada na requisição do serviço web. Esse termo de autorização está assinado digitalmente com o certificado digital do PROCURADOR ou OUTORGADO DO CONTRIBUINTE responsável, identificado como AUTOR DO PEDIDO DE DADOS.';
const AVISO =
  'O acesso a estas informações foi autorizado pelo próprio PROCURADOR ou OUTORGADO DO CONTRIBUINTE, responsável pela informação, via assinatura digital. É dever do destinatário da autorização e consumidor deste acesso observar a adoção de base legal para o tratamento dos dados recebidos conforme artigos 7º ou 11º da LGPD (Lei n.º 13.709, de 14 de agosto de 2018), aos direitos do titular dos dados (art. 9º, 17 e 18, da LGPD) e aos princípios que norteiam todos os tratamentos de dados no Brasil (art. 6º, da LGPD).';
const FINAL =
  'A finalidade única e exclusiva desse TERMO DE AUTORIZAÇÃO, é garantir que o CONTRATANTE apresente a API INTEGRA CONTADOR esse consentimento do PROCURADOR ou OUTORGADO DO CONTRIBUINTE assinado digitalmente, para que possa realizar as requisições dos serviços web da API INTEGRA CONTADOR em nome do AUTOR PEDIDO DE DADOS (PROCURADOR ou OUTORGADO DO CONTRIBUINTE).';

/** Monta o XML do Termo (destinatário=contratante, assinadoPor=autor/empresa). */
export function buildTermoXml(params: {
  destinatario: TermoParte;
  autor: TermoParte;
  hoje?: Date;
  vigenciaDias?: number;
}): string {
  const hoje = params.hoje ?? new Date();
  const vig = new Date(hoje.getTime());
  vig.setUTCDate(vig.getUTCDate() + (params.vigenciaDias ?? 365));
  const d = params.destinatario;
  const a = params.autor;
  return `<?xml version="1.0" encoding="UTF-8"?><termoDeAutorizacao><dados><sistema id="API Integra Contador"/><termo texto="${TERMO}"/><avisoLegal texto="${AVISO}"/><finalidade texto="${FINAL}"/><dataAssinatura data="${ymd(hoje)}"/><vigencia data="${ymd(vig)}"/><destinatario numero="${d.cnpj}" nome="${d.nome}" tipo="PJ" papel="contratante"/><assinadoPor numero="${a.cnpj}" nome="${a.nome}" tipo="PJ" papel="autor pedido de dados"/></dados></termoDeAutorizacao>`;
}

/** DER base64 a partir do PEM (corpo entre os marcadores, sem espaços). */
function certPemToDerB64(certPem: string): string {
  return certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

/** Assina o Termo (XMLDSig enveloped, RSA-SHA256) com a chave da empresa. */
export function signTermoXml(xml: string, signer: { keyPem: string; certPem: string }): string {
  const certDerB64 = certPemToDerB64(signer.certPem);
  const sig = new SignedXml({
    privateKey: signer.keyPem,
    publicCert: signer.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='termoDeAutorizacao']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: '',
    isEmptyUri: true,
  });
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certDerB64}</X509Certificate></X509Data>`;
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='termoDeAutorizacao']", action: 'append' },
  });
  return sig.getSignedXml();
}
