// Qual item do menu lateral acende para uma URL.
//
// POR QUE SAIU DO COMPONENTE
// Enquanto nenhum href era prefixo de outro, `pathname.startsWith(href)` bastava
// e não havia o que testar. A seção "Cobranças" do Bloco 4B acabou com isso:
// `/contador/configuracoes` é prefixo de `/contador/configuracoes/subconta`, e
// os DOIS itens acendiam ao mesmo tempo — o menu dizendo que o usuário está em
// dois lugares. Regra nova pede teste, e não há jsdom neste repo para testar o
// componente: então a regra vira função pura e o componente só a chama.
//
// Puro de propósito: sem React, sem `next/navigation`, sem I/O.

/**
 * O href do item que deve aparecer como ativo, ou `null` quando nenhum casa.
 *
 * Duas decisões:
 *
 *  1. **O mais longo vence.** Em `/contador/configuracoes/subconta` casam tanto
 *     `/contador/configuracoes` quanto `/contador/configuracoes/subconta`; o
 *     item mais específico é sempre o que descreve onde o usuário está.
 *
 *  2. **O prefixo tem de terminar em `/`.** `startsWith('/contador')` casaria
 *     também com uma futura `/contadores` — item errado aceso numa tela que não
 *     tem nada a ver. `startsWith('/contador/')` não tem esse problema, e a
 *     igualdade exata cobre a própria `/contador`.
 *
 * A raiz `/` só casa por igualdade: ela é prefixo de tudo.
 */
export function hrefAtivo(hrefs: readonly string[], pathname: string): string | null {
  return hrefs
    .filter((h) => pathname === h || (h !== '/' && pathname.startsWith(`${h}/`)))
    .reduce<string | null>((melhor, h) => (melhor && melhor.length >= h.length ? melhor : h), null);
}
