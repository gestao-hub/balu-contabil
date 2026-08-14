// Guard de destino para o `action_href` gravado em `notifications`.
//
// Módulo puro (sem `server-only`, sem imports de Next) pelo mesmo motivo de
// `app/api/webhooks/segredo.ts`: `route.ts` só pode exportar handler HTTP, e o
// `next build` recusa o resto — então uma função de segurança que vive lá
// dentro não tem como ser exercitada por teste unitário.

/**
 * Devolve o caminho interno seguro de `href`, ou `null` se ele sai do domínio.
 *
 * ⚠️ CHECAR PREFIXO NÃO BASTA. A versão anterior deste guard recusava só `//`
 * (protocol-relative) e esquemas absolutos. Mas o parser de URL da WHATWG
 * normaliza `\` para `/` em esquemas especiais e ignora tab/CR/LF dentro da
 * URL, então TODAS estas escapavam para fora, verificadas uma a uma:
 *
 *     '/\evil.com'      -> https://evil.com/
 *     '/\\evil.com'     -> https://evil.com/
 *     '/\t/evil.com'    -> https://evil.com/
 *     '/\n/evil.com'    -> https://evil.com/
 *
 * A defesa que não depende de enumerar variante é deixar o PARSER resolver e
 * comparar a origem do resultado — e é o mesmo parser que o
 * `NextResponse.redirect` usa depois, então não há divergência possível entre
 * o que foi validado e o que será seguido.
 *
 * Defesa em profundidade, e não teatro: `notifications` não tem policy de
 * INSERT (só a RPC `SECURITY DEFINER` e o service role escrevem), mas tem
 * `notifications_update_own` sem GRANT por coluna — o dono da linha consegue
 * reescrever o próprio `action_href`. A vítima seria ele mesmo; ainda assim,
 * um guard tem de valer o que promete.
 */
export function rotaInterna(href: string | null | undefined, origem: string): string | null {
  if (!href || !href.startsWith('/')) return null;
  try {
    const base = new URL(origem);
    const alvo = new URL(href, base);
    if (alvo.origin !== base.origin) return null;
    // A forma normalizada pelo parser, não a string crua: é ela que o redirect
    // vai seguir, e devolvê-la evita que os dois discordem.
    return `${alvo.pathname}${alvo.search}${alvo.hash}`;
  } catch {
    return null;
  }
}
