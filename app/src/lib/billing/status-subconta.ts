// Bloco 4B — status do KYC da subconta: vocabulario do Asaas → vocabulario da
// coluna `contabilidades.asaas_subconta_status`.
//
// POR QUE ESTE MODULO EXISTE
// O 4B gateia a emissao de cobranca em `asaas_subconta_status = 'aprovada'`,
// mas nada movia a coluna de 'pendente' para la: a criacao grava 'pendente' e
// `listarSubcontas` (conta-mae) devolve so `{ id, name }`, sem nenhum campo de
// KYC. Sem este mapeamento o bloco inteiro nunca emite uma cobranca.
//
// O QUE FOI OBSERVADO NO SANDBOX (nao e o que a doc promete):
//   GET /v3/myAccount/status, com o token de UMA conta, devolve
//   {"id":"…","commercialInfo":"APPROVED","bankAccountInfo":"APPROVED",
//    "documentation":"APPROVED","general":"APPROVED"}
//   — quatro eixos independentes, string maiuscula. Nao ha rota equivalente
//   POR SUBCONTA pela conta-mae: `GET /v3/accounts` lista `{ id, name }` e
//   `GET /v3/accounts/{id}` responde 404 para id desconhecido, mas nao havia
//   nenhuma subconta no sandbox para provar que traz KYC. Entao a consulta e
//   feita com a apiKey DA PROPRIA SUBCONTA (`asaasSub(...).consultarStatusConta`).
//
// O unico valor que deu para OBSERVAR ao vivo foi `APPROVED` — a conta-mae
// esta 100% aprovada e nao existe subconta pendente no sandbox. Os demais
// (`PENDING`, `AWAITING_APPROVAL`, `REJECTED`) vem da documentacao do Asaas, e
// e exatamente por isso que este mapeamento NAO confia em conhecer o conjunto:
// ele so promove a 'aprovada' com igualdade exata a `APPROVED` em todos os
// eixos. Qualquer string desconhecida — inclusive um valor novo que o Asaas
// invente amanha, ou `EXPIRED` do commercialInfo — cai em 'pendente'.
//
// O ERRO CARO E O OPOSTO DO INTUITIVO: marcar 'aprovada' cedo demais custa uma
// cobranca falhando na cara do escritorio, na frente do cliente dele. Marcar
// tarde demais custa um clique a mais em "sincronizar". A assimetria manda.
//
// Puro e fora do `actions.ts` de proposito: arquivo 'use server' so pode
// exportar funcao async, e exportar funcao pura de la quebra no `next build`
// sem o `tsc --noEmit` reclamar.

/** Vocabulario fechado da coluna (CHECK da migration 0053). */
export type StatusSubconta = 'ausente' | 'pendente' | 'aprovada' | 'recusada';

/** 'ausente' e decidido por quem nao tem subconta nenhuma; quem tem payload de
 *  status do Asaas nunca volta para la. */
export type StatusSubcontaComConta = Exclude<StatusSubconta, 'ausente'>;

/** Resposta de `GET /v3/myAccount/status`. Campos opcionais de proposito: um
 *  eixo ausente e "nao aprovado", nunca um crash. */
export type StatusContaAsaas = {
  commercialInfo?: string | null;
  bankAccountInfo?: string | null;
  documentation?: string | null;
  general?: string | null;
};

/**
 * OS QUATRO EIXOS, TODOS EXIGIDOS.
 *
 * A doc do Asaas diz que `general` deriva so de `commercialInfo` e
 * `documentation` — ou seja, `general: APPROVED` com
 * `bankAccountInfo: PENDING` e um estado possivel. Exigir os quatro e a
 * escolha deliberada:
 *  1. nao observei nenhuma subconta parcialmente aprovada emitindo cobranca,
 *     entao afrouxar para `general` sozinho seria apostar na doc — e o 4A ja
 *     ensinou o preco disso (o `nextDueDate` que era o ciclo SEGUINTE);
 *  2. subconta que cobra mas nao tem conta bancaria aprovada acumula saldo que
 *     o escritorio nao consegue sacar. Isso e uma armadilha de outro tipo, nao
 *     um sucesso;
 *  3. o custo de exigir demais e visivel e reversivel (o escritorio completa o
 *     cadastro no Asaas e sincroniza de novo); o de exigir de menos e a
 *     cobranca falhar na hora de cobrar.
 */
export const EIXOS_KYC = [
  'commercialInfo',
  'bankAccountInfo',
  'documentation',
  'general',
] as const satisfies readonly (keyof StatusContaAsaas)[];

const APROVADO = 'APPROVED';
const RECUSADO = 'REJECTED';

const normalizar = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase();

/**
 * Payload de `GET /v3/myAccount/status` → valor da coluna.
 *
 *  - qualquer eixo `REJECTED` → 'recusada' (recusa manda em aprovacao parcial:
 *    o escritorio precisa saber que parou, nao ficar em "pendente" para sempre);
 *  - todos os quatro exatamente `APPROVED` → 'aprovada';
 *  - todo o resto — inclusive payload nulo, eixo ausente e valor que nao
 *    conheco → 'pendente'.
 */
export function mapearStatusSubconta(s: StatusContaAsaas | null | undefined): StatusSubcontaComConta {
  const eixos = EIXOS_KYC.map((k) => normalizar(s?.[k]));
  if (eixos.some((v) => v === RECUSADO)) return 'recusada';
  if (eixos.every((v) => v === APROVADO)) return 'aprovada';
  return 'pendente';
}
