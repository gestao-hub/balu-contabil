// Validacao de segredo de webhook — modulo puro (sem `server-only`, sem
// imports de Next) pra poder ser importado tanto pelas routes quanto pelos
// testes unitarios sem disparar a validacao de exports do App Router.
//
// Duas formas porque os provedores diferem: a Focus manda na query (?s=),
// o Asaas manda no header (asaas-access-token).
import { timingSafeEqual } from 'node:crypto';

/** Comparacao em tempo constante. A checagem de comprimento vem ANTES
 *  porque `timingSafeEqual` LANCA quando os buffers tem tamanhos
 *  diferentes — sem isso o webhook viraria 500 em vez de rejeitar. */
function iguais(recebido: string, esperado: string): boolean {
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
