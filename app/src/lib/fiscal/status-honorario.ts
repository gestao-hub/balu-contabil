// Status derivado (nunca confiar na coluna `status` armazenada para exibição —
// ela pode ficar desatualizada; o vencimento é comparado contra `hoje` em runtime).
import { ymdBrt } from './tempo-brt';

export type StatusHonorario = 'pago' | 'atrasado' | 'aberto';

export function statusHonorario(
  h: { data_pagamento: string | null; data_vencimento: string },
  hoje = new Date(),
): StatusHonorario {
  if (h.data_pagamento) return 'pago';
  // data BRT (não UTC) — senão nas ~3h finais do dia um honorário vencendo "hoje"
  // aparece como atrasado antes do dia acabar no Brasil.
  return h.data_vencimento < ymdBrt(hoje) ? 'atrasado' : 'aberto';
}
