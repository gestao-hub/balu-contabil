// Bloco 4A — regras puras da liberação manual.
//
// MORA FORA DO `actions.ts` porque aquele é `'use server'`, e todo export de
// um arquivo 'use server' tem de ser uma Server Action assíncrona. Constante
// e função síncrona ali quebram o `next build` — e `tsc --noEmit` NÃO pega,
// porque a validação vive nos tipos gerados em `.next/types`. Mesma lição que
// o Bloco 3 e o `lib/billing/cron.ts` já registraram.

/** Teto de dias por liberação. Não é burocracia: liberação é exceção, e uma
 *  exceção longa demais é indistinguível de conta de graça. Precisou de mais?
 *  Renove — e o audit_log guarda cada renovação. */
export const MAX_DIAS_LIBERACAO = 60;

/** Sugestão: cobre a compensação de um boleto (1 a 3 dias úteis) com folga
 *  para fim de semana e feriado. */
export const DIAS_LIBERACAO_PADRAO = 7;

/**
 * `hoje + dias` como data civil, em BRT.
 *
 * Só string, nunca Date: a aritmética de data com fuso já errou no Bloco A e
 * no Bloco 3, e aqui um dia a menos corta o acesso de quem pagou.
 */
export function dataLiberacao(dias: number, hoje: string): string {
  const t = Date.parse(`${hoje}T00:00:00Z`) + dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
