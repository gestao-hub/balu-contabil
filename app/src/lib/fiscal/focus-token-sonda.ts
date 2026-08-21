// Bloco 5 (produção fiscal) — conserto 1, revisado na 0099: classificador puro
// da sonda de token da Focus para a conta da plataforma.
//
// RENOMEADO de `focus-revenda-sonda.ts`. O nome antigo prometia "revenda" —
// e a sonda batia em `GET /v2/empresas/:id`, o endpoint de revenda. Isso
// parou de fazer sentido em 20/08/2026: essa conta leva 401 em
// `/v2/empresas` NOS DOIS AMBIENTES, para os dois tokens, por falta de
// permissão no Gateway da Focus — não por causa do token. Sondar por ali
// teria RECUSADO os dois tokens corretos do dono do produto, exatamente o
// oposto do que uma validação deveria fazer.
//
// A sonda agora bate em `GET /v2/codigos_cnae/6201501` — código de CNAE real,
// fixo, presente no catálogo dos dois ambientes — NA BASE DO AMBIENTE DO
// TOKEN QUE ESTÁ SENDO TESTADO:
//   - homologacao.focusnfe.com.br, para o token de homologação;
//   - api.focusnfe.com.br,         para o token de produção.
// Essa é a medição que realmente discrimina o token (ver cabeçalho da 0099):
// cada token dá 200 na sua base e 401 na outra, mesmo sem nenhuma permissão
// de revenda. É o par (token, ambiente) que a sonda valida — não a conta.
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
