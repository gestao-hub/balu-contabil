// Validação do segredo do webhook Focus — módulo puro (sem `server-only`,
// sem imports de Next) pra poder ser importado tanto pela route quanto pelo
// teste unitário sem disparar a validação de exports do App Router.
import { timingSafeEqual } from 'node:crypto';

export function segredoOk(req: Request): boolean {
  const esperado = process.env.FOCUS_WEBHOOK_SECRET ?? '';
  const recebido = new URL(req.url).searchParams.get('s') ?? '';
  if (!esperado || recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}
