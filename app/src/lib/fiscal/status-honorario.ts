// Status derivado (nunca confiar na coluna `status` armazenada para exibição —
// ela pode ficar desatualizada; o vencimento é comparado contra `hoje` em runtime).
export type StatusHonorario = 'pago' | 'atrasado' | 'aberto';

export function statusHonorario(
  h: { data_pagamento: string | null; data_vencimento: string },
  hoje = new Date(),
): StatusHonorario {
  if (h.data_pagamento) return 'pago';
  return h.data_vencimento < hoje.toISOString().slice(0, 10) ? 'atrasado' : 'aberto';
}
