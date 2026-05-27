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

// Deriva quais credenciais o município exige a partir da string `autenticacao`
// (pode conter combinações: "Certificado digital, Login e Senha, Token").
export function credenciaisDaAutenticacao(autenticacao: string | null | undefined): CredenciaisNfse {
  const a = (autenticacao ?? '').toLowerCase();
  return {
    login: a.includes('login e senha'),
    token: a.includes('token'),
    certificado: a.includes('certificado'),
  };
}
