// Bloco 5 (produção fiscal) — conserto 1, revisado na 0099: classificador puro
// da sonda de token da Focus para a conta da plataforma.
//
// RENOMEADO de `focus-revenda-sonda.ts`. O nome antigo prometia "revenda" —
// e a sonda batia em `GET /v2/empresas/:id`, o endpoint de revenda.
//
// ⚠️ 27/08/2026 — A PREMISSA DESTE ARQUIVO ESTAVA ERRADA, E ELA ESTÁ CORRIGIDA
// ABAIXO. O texto que ficou aqui de 20/08 a 27/08 dizia: "essa conta leva 401
// em `/v2/empresas` para os dois tokens por falta de permissão no Gateway da
// Focus — não por causa do token; sondar por ali teria RECUSADO os dois tokens
// corretos". As duas metades eram falsas, e a segunda transformou a primeira em
// regra de código: a sonda passou a aprovar QUALQUER token válido.
//
// O que a Focus respondeu por escrito (suporte, Hélio Marques, 27/08/2026): a
// conta e o acesso estão liberados, INCLUSIVE para a API de Empresas — e "para
// operar nessa API é preciso utilizar, exclusivamente, o token principal de
// produção" (Serviços > Painel API > Tokens). Não faltava permissão: faltava o
// token certo.
//
// O que foi medido no mesmo dia, contra a API real, com o token que estava
// configurado em produção:
//
//   GET /v2/codigos_cnae/6201501  [api.focusnfe.com.br]  -> 200  ✅
//   GET /v2/empresas              [api.focusnfe.com.br]  -> 401  permissao_negada
//                                 "Access token inválido (host: api.focusnfe.com.br)"
//
// MESMO HOST, MESMO TOKEN, UM ACEITA E O OUTRO NÃO. É essa diferença que dá o
// veredito, e é justamente ela que a sonda antiga não conseguia enxergar.
//
// A REGRA, ENTÃO, É POR AMBIENTE — e não por preferência de estilo:
//
//   - homologação → `GET /v2/codigos_cnae/6201501` em
//     `homologacao.focusnfe.com.br`. `/v2/empresas` NÃO EXISTE nessa base (404
//     `nao_encontrado`, medido), então não há por onde discriminar melhor.
//   - produção → o catálogo PRIMEIRO (o token vale nesta base?) e, só se ele
//     passar, `GET /v2/empresas` (e é o token PRINCIPAL?). São duas perguntas
//     diferentes e elas falham por motivos diferentes: juntar as duas numa
//     resposta só foi exatamente o erro que custou 35 dias.
//
// O 401 do catálogo continua sendo evidência de token trocado de ambiente (hom
// contra prod, ou vice-versa) — isso a medição de 20/08 acertou e segue valendo.
//
// Este módulo classifica o RESULTADO de uma sonda já feita — não faz a
// chamada de rede — para que `salvarConfigFocusAction` (testa o token NOVO
// antes de gravar) e `testarConexaoFocusAction` (testa o token já gravado, a
// pedido do admin) usem exatamente a mesma regra.
//
//   - 401/403 → o token não vale NESSE ambiente. É a evidência que importa —
//     inclusive quando é o token certo, só testado do lado errado (hom
//     contra prod, ou vice-versa).
//   - sucesso → token válido nesse ambiente.
//   - resto (rede, 5xx, timeout) → não houve recusa. Ler isso como "token
//     inválido" mandaria o admin trocar uma credencial que estava certa, e
//     travar a gravação só porque a Focus está fora do ar impediria alguém de
//     configurar uma credencial nova por um motivo que não é dela.
//
// SEM CASO ESPECIAL PARA 404: ao contrário da sonda antiga (que testava um id
// de empresa que nunca existe, e por isso lia 404 como "token válido"), o
// código de CNAE aqui é fixo e sabidamente existente nos dois catálogos — um
// 404 legítimo não é esperado, e se aparecer não é evidência de token válido
// nem inválido. Cai em "indeterminado", como qualquer resposta que não seja
// 200/401/403.

export type ResultadoSondaTokenFocus =
  | { status: 'aceito' }
  /** Token VÁLIDO na base de produção, mas recusado por `GET /v2/empresas` —
   *  ou seja, não é o token principal de produção. Estado próprio, e não um
   *  'recusado', porque a ação a tomar é outra: não é trocar de ambiente, é
   *  pegar o token principal no painel da Focus. Fundir os dois numa recusa
   *  genérica mandaria o admin procurar o erro no lugar errado. */
  | { status: 'nao_principal'; motivo: string }
  | { status: 'recusado'; motivo: string }
  | { status: 'indeterminado'; motivo: string };

/** `erro` é o que um `try/catch` em volta da sonda capturou — `null`/`undefined`
 *  quando a chamada teve sucesso. */
export function classificarSondaTokenFocus(erro: unknown): ResultadoSondaTokenFocus {
  if (erro === null || erro === undefined) return { status: 'aceito' };
  const motivo = erro instanceof Error ? erro.message : String(erro);
  if (/→ 401|→ 403/.test(motivo)) return { status: 'recusado', motivo };
  return { status: 'indeterminado', motivo };
}

/**
 * Junta as DUAS sondas do ambiente de produção num veredito só.
 *
 * Pura de propósito, pelo mesmo motivo de `classificarSondaTokenFocus`: a regra
 * que decide o que o admin vê tem de ser testável sem rede.
 *
 * A ORDEM IMPORTA, e ela não é arbitrária — o catálogo responde "este token
 * vale nesta base?" e a API de Empresas responde "e ele é o principal?". A
 * segunda pergunta só faz sentido depois de a primeira passar: um token de
 * homologação colado no campo de produção leva 401 nas DUAS, e chamá-lo de
 * "não principal" esconderia o que de fato aconteceu (campos trocados).
 */
export function combinarSondaProducao(
  catalogo: ResultadoSondaTokenFocus,
  empresas: ResultadoSondaTokenFocus,
): ResultadoSondaTokenFocus {
  // O catálogo é o porteiro: recusa ou dúvida dele encerram o assunto, e a
  // sonda de `/v2/empresas` nem chega a ser consultada.
  if (catalogo.status !== 'aceito') return catalogo;

  if (empresas.status === 'aceito') return { status: 'aceito' };
  if (empresas.status === 'recusado') {
    return {
      status: 'nao_principal',
      motivo:
        'o token vale em api.focusnfe.com.br (o catálogo respondeu), mas a API de Empresas ' +
        `(GET /v2/empresas) o recusou: ${empresas.motivo}`,
    };
  }
  // A Focus não recusou — só não deu para confirmar (rede, 5xx, timeout). O
  // token está PROVADO válido na base de produção pelo catálogo; o que ficou em
  // aberto é se ele é o principal. Isso é 'indeterminado', não 'aceito': dizer
  // "aceito" aqui é a mentira exata que esta correção existe para acabar.
  return {
    status: 'indeterminado',
    motivo: `não foi possível confirmar em GET /v2/empresas: ${empresas.motivo}`,
  };
}
