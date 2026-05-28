// @custom — Helper canônico pra resolver a base URL do app server-side.
//
// **Segurança**: NUNCA derive URLs de redirect/email de request headers
// (`Host`, `Origin`, `x-forwarded-proto`). Um atacante pode forjar esses
// headers (Host Header Injection) e fazer o app gerar links de confirmação
// apontando pro domínio dele, sequestrando o token enviado pro email.
//
// Em dev, fallback pra http://localhost:3000 pra não obrigar setup de env.
// Em prod, falha hard se NEXT_PUBLIC_SITE_URL não estiver configurado — é
// melhor o signup falhar visivelmente do que mandar links inválidos ou
// inseguros.

const PROD_URL_REGEX = /^https?:\/\/[^/]+$/;

/**
 * Retorna a URL canônica do app (sem barra no final). Use pra montar
 * `emailRedirectTo`, `redirectTo` e outros links que vão pra fora.
 *
 * Ordem de resolução:
 *   1. NEXT_PUBLIC_SITE_URL    — preferido (acessível server + client)
 *   2. SITE_URL                — alternativo só-server
 *   3. http://localhost:3000   — fallback de dev (NODE_ENV !== 'production')
 *
 * Em prod sem env definida, lança Error.
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv) {
    const trimmed = fromEnv.replace(/\/+$/, '');
    if (!PROD_URL_REGEX.test(trimmed)) {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL inválido (${fromEnv}). Esperado http(s)://host[:port], sem path.`,
      );
    }
    return trimmed;
  }
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw new Error(
    'NEXT_PUBLIC_SITE_URL não configurado. Defina a URL canônica do app (ex: https://balu.app) para gerar links de email seguros.',
  );
}
