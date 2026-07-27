// Validacao do segredo do webhook Focus. A logica de comparacao mora em
// `../segredo` (compartilhada com o webhook do Asaas); este arquivo so fixa
// de onde vem o valor (query `?s=`) e qual env o guarda. Assinatura e
// comportamento preservados — `segredo.test.ts` ao lado prova isso.
import { segredoDaQuery } from '../segredo';

export function segredoOk(req: Request): boolean {
  return segredoDaQuery(req, 's', process.env.FOCUS_WEBHOOK_SECRET ?? '');
}
