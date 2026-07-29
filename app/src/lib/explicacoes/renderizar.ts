// Bloco 6A — o texto do catálogo vira o texto da tela.
//
// É AQUI QUE OS NÚMEROS ENTRAM, e é o único lugar. O catálogo guarda
// "{inss} de INSS"; o valor do contribuinte só encosta no texto neste módulo,
// dentro da Balu, depois de a IA ter ido embora há muito tempo.
//
// Puro: sem I/O, sem React.

const MARCADOR = /\{([a-z0-9_]+)\}/gi;

/** Os marcadores de um texto, sem repetição e na ordem em que aparecem.
 *  A aprovação usa isto para recusar texto com marcador que a situação não
 *  fornece (ver a action de aprovar). */
export function marcadoresDe(texto: string): string[] {
  return [...new Set(Array.from(texto.matchAll(MARCADOR), (m) => m[1]))];
}

export type Renderizacao =
  | { ok: true; texto: string }
  | { ok: false; faltando: string[] };

/**
 * FALHA FECHADA: faltando valor para qualquer marcador, não devolve texto
 * nenhum. Renderizar "{iss}" cru na tela do cliente seria pior que não explicar
 * — dá a impressão de sistema quebrado justamente numa tela sobre imposto.
 *
 * Isto é a rede de baixo. A trava de cima é a validação no ato de APROVAR, que
 * impede o texto incompatível de entrar no catálogo.
 */
export function renderizar(texto: string, valores: Record<string, string>): Renderizacao {
  const faltando = marcadoresDe(texto).filter((m) => valores[m] === undefined);
  if (faltando.length) return { ok: false, faltando };
  return { ok: true, texto: texto.replace(MARCADOR, (_, k: string) => valores[k]) };
}
