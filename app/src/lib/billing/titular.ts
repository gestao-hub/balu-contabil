// Bloco 4A — quem responde pela assinatura de uma empresa. Puro, sem I/O.
//
// A regra le o multitenant que o Bloco A ja construiu: nenhum campo novo
// diz "quem paga por quem".

export type Titular =
  | { tipo: 'company'; id: string }
  | { tipo: 'coberta_por_escritorio'; id: string };

export function titularDaEmpresa(c: { id: string; contabilidade_id: string | null }): Titular {
  return c.contabilidade_id
    ? { tipo: 'coberta_por_escritorio', id: c.contabilidade_id }
    : { tipo: 'company', id: c.id };
}
