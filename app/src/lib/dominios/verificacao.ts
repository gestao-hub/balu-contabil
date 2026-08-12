// Bloco 7 — verificacao do dominio proprio por HTTP (decisao §2.2 da spec).
//
// O app busca, DE FORA, o token daquele escritorio no proprio host:
//   GET https://<host>/api/dominio/verificacao
// Se voltar o token certo, tres coisas ficaram provadas de uma vez — o DNS
// aponta pra ca, o TLS esta de pe, e quem responde ali e este app. Um
// registro TXT no DNS provaria so posse do dominio, que e menos do que
// interessa.
import 'server-only';

export type ResultadoVerificacao =
  | { ok: true }
  | { ok: false; motivo: string };

/** `fetch` injetavel para o teste nao depender de rede. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * O motivo devolvido vai direto pra tela do contador — tem que ser frase de
 * gente, nunca stack trace nem corpo de resposta cru.
 */
export async function verificarHost(
  host: string,
  tokenEsperado: string,
  fetchImpl: FetchLike = fetch,
): Promise<ResultadoVerificacao> {
  if (!tokenEsperado) return { ok: false, motivo: 'Este domínio ainda não tem token de verificação. Salve o domínio novamente.' };

  let res: Response;
  try {
    res = await fetchImpl(`https://${host}/api/dominio/verificacao`, {
      // `no-store`: verificar duas vezes tem que consultar duas vezes.
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // DNS inexistente, TLS invalido, conexao recusada e timeout caem todos
    // aqui, e a distincao entre eles nao muda o que o contador faz a seguir.
    return { ok: false, motivo: 'Não conseguimos acessar https://' + host + '. Confira o apontamento de DNS e aguarde a propagação (pode levar algumas horas).' };
  }

  if (!res.ok) {
    return { ok: false, motivo: `O domínio respondeu ${res.status}. Ele já aponta para outro site? O apontamento precisa ser para o app da Balu.` };
  }

  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    return { ok: false, motivo: 'O domínio respondeu, mas não é o app da Balu que está atendendo nele.' };
  }

  const token = (corpo as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || token !== tokenEsperado) {
    // Acontece de verdade quando o host aponta para OUTRO escritorio (ou
    // para o dominio principal): responde 200, com o token de outra pessoa.
    return { ok: false, motivo: 'O domínio está respondendo, mas com o registro de outro escritório. Confira se o apontamento é do domínio certo.' };
  }

  return { ok: true };
}
