// Bloco 5 (produção fiscal) — conserto 1: classificador puro da sonda de
// revenda da Focus (`GET /v2/empresas/:id`).
//
// POR QUE ISTO EXISTE: em 20/08/2026 o admin colou, no campo "token de
// revenda" de `admin/configuracoes/focus`, o token de EMISSÃO da empresa —
// engano razoável, porque os dois se chamam "token da Focus" e o de empresa
// FUNCIONA nas consultas de catálogo. A tela gravou sem testar. Como o valor
// do banco vence o do `.env` e campo vazio significa "não trocar", não havia
// caminho pela interface para desfazer — cadastro de empresa, upload de
// certificado A1 e o botão Sincronizar passaram a responder 401 em produção.
//
// Este módulo classifica o RESULTADO de uma sonda já feita — não faz a
// chamada de rede — para que `salvarConfigFocusAction` (testa o token NOVO
// antes de gravar) e `testarConexaoFocusAction` (testa o token já gravado, a
// pedido do admin) usem exatamente a mesma regra.
//
// A leitura é deliberadamente conservadora — mesma invariante da 0095:
//   - 401/403 → o token não tem acesso à REVENDA. É a evidência que importa.
//   - 404     → token VÁLIDO na revenda; só não achou o id da sonda, que é o
//               esperado (o id nunca é de uma empresa nossa).
//   - sucesso → token válido.
//   - resto (rede, 5xx, timeout) → não houve recusa. Ler isso como "token
//     inválido" mandaria o admin trocar uma credencial que estava certa, e
//     travar a gravação só porque a Focus está fora do ar impediria alguém de
//     configurar uma credencial nova por um motivo que não é dela.

export type ResultadoSondaRevendaFocus =
  | { status: 'aceito' }
  | { status: 'recusado'; motivo: string }
  | { status: 'indeterminado'; motivo: string };

/** `erro` é o que um `try/catch` em volta da sonda capturou — `null`/`undefined`
 *  quando a chamada teve sucesso. */
export function classificarSondaRevendaFocus(erro: unknown): ResultadoSondaRevendaFocus {
  if (erro === null || erro === undefined) return { status: 'aceito' };
  const motivo = erro instanceof Error ? erro.message : String(erro);
  if (/→ 404/.test(motivo)) return { status: 'aceito' };
  if (/→ 401|→ 403/.test(motivo)) return { status: 'recusado', motivo };
  return { status: 'indeterminado', motivo };
}
