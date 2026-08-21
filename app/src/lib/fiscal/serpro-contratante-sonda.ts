// Bloco 5 (produção fiscal) — conserto 1: classificador puro da sonda de
// credencial do SERPRO (`autenticarContratante`, o `/authenticate` real).
//
// Irmão de `focus-token-sonda.ts` — mesma ideia, contrato diferente.
// Deliberadamente um módulo PRÓPRIO, e não reuso do da Focus: o cabeçalho de
// `lib/fiscal/config-serpro.ts` já registra que os dois domínios não
// compartilham código de propósito, para uma regra nova de um não alcançar o
// outro sem alguém decidir isso.
//
// Este módulo classifica o RESULTADO de uma sonda já feita — não faz a
// chamada de rede — para que `salvarConfigSerproAction` (testa a credencial
// NOVA antes de gravar) e `testarConexaoSerproAction` (testa a credencial já
// gravada, a pedido do admin) usem exatamente a mesma regra: 401/403 é
// recusa (a única evidência que importa); qualquer outra coisa — rede, 5xx,
// timeout — é indeterminado, porque o `/authenticate` do SERPRO não tem um
// equivalente ao "404 de revenda" da Focus (não há id para consultar).

export type ResultadoSondaContratanteSerpro =
  | { status: 'aceito' }
  | { status: 'recusado'; motivo: string }
  | { status: 'indeterminado'; motivo: string };

/** `erro` é o que um `try/catch` em volta da sonda capturou — `null`/`undefined`
 *  quando a chamada teve sucesso. */
export function classificarSondaContratanteSerpro(erro: unknown): ResultadoSondaContratanteSerpro {
  if (erro === null || erro === undefined) return { status: 'aceito' };
  const motivo = erro instanceof Error ? erro.message : String(erro);
  if (/→ 401|→ 403/.test(motivo)) return { status: 'recusado', motivo };
  return { status: 'indeterminado', motivo };
}
