// Comparacao de segredo compartilhado, em tempo constante.
//
// Morava em `app/api/webhooks/segredo.ts` e servia so aos webhooks. Subiu para
// `lib/security/` quando os quatro crons passaram a usar a mesma comparacao
// (auditoria 25/08): eles conferiam o `Authorization` com `!==`, enquanto os
// webhooks ao lado ja faziam `timingSafeEqual`. Duas formas de comparar segredo
// no mesmo repositorio e uma escolha esperando ser feita errado.
//
// Modulo PURO: sem `server-only`, sem imports de Next — para poder ser
// importado tanto por route handlers quanto por testes unitarios sem disparar
// a validacao de exports do App Router.
import { timingSafeEqual } from 'node:crypto';

/** Comparacao em tempo constante. A checagem de comprimento vem ANTES
 *  porque `timingSafeEqual` LANCA quando os buffers tem tamanhos
 *  diferentes — sem isso o handler viraria 500 em vez de rejeitar.
 *
 *  `!esperado` fecha o fail-open: com a variavel de ambiente ausente,
 *  `esperado` e '' e QUALQUER requisicao passaria (inclusive uma sem o
 *  parametro, que tambem vira ''). Segredo nao configurado nega tudo. */
export function iguais(recebido: string, esperado: string): boolean {
  if (!esperado || recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

export function segredoDaQuery(req: Request, param: string, esperado: string): boolean {
  const recebido = new URL(req.url).searchParams.get(param) ?? '';
  return iguais(recebido, esperado);
}

export function segredoDoHeader(req: Request, header: string, esperado: string): boolean {
  const recebido = req.headers.get(header) ?? '';
  return iguais(recebido, esperado);
}

/** Autorizacao dos crons: header `Authorization: Bearer <CRON_SECRET>`.
 *
 *  Devolve a resposta de recusa ou `null` quando pode seguir — assim os quatro
 *  handlers nao repetem a decisao de status nem a ordem das checagens. Segredo
 *  ausente e 500 (defeito de configuracao nosso), segredo errado e 401. */
export function checarCron(req: Request): { status: number; body: { error: string } } | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { status: 500, body: { error: 'CRON_SECRET não configurado' } };
  if (!segredoDoHeader(req, 'authorization', `Bearer ${secret}`)) {
    return { status: 401, body: { error: 'Não autorizado' } };
  }
  return null;
}
