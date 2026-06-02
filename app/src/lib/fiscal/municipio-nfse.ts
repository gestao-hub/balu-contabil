// @custom — PR 1.5: helpers puros de município/autenticação NFS-e (sem deps de server/React).

// Normaliza nome de município p/ comparação: minúsculo, sem acento, trim.
export function normalizeNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export type CredenciaisNfse = { login: boolean; token: boolean; certificado: boolean };

/**
 * Deriva quais credenciais o município exige a partir dos campos da Focus API.
 * Provedores "Nacional*" usam só certificado (sem login/senha/token).
 * Provedores legados geralmente aceitam login+senha e/ou token — mostramos ambos
 * e o usuário preenche o que o provedor exige.
 */
export function credenciaisDaAutenticacao(
  municipio: { provedor_nfse: string | null; requer_certificado_nfse: boolean | null } | null | undefined,
): CredenciaisNfse {
  if (!municipio) return { login: false, token: false, certificado: false };
  const isNacional = (municipio.provedor_nfse ?? '').startsWith('Nacional');
  return {
    login: !isNacional,
    token: !isNacional,
    certificado: municipio.requer_certificado_nfse === true,
  };
}
