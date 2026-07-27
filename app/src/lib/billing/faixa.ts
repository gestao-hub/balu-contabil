// Bloco 4A — escolha do plano de escritorio pela quantidade de clientes.
// Puro, sem I/O.

export type PlanoFaixa = {
  id: string;
  clientes_min: number | null;
  clientes_max: number | null;   // null = faixa aberta no topo
  ativo: boolean;
};

export type ResultadoFaixa =
  | { ok: true; planoId: string }
  | { ok: false; motivo: 'sem_faixa' | 'qtd_invalida' };

/**
 * Nunca devolve undefined implicito: o AdminBalu edita as faixas em runtime,
 * entao um buraco entre elas e um estado alcancavel. Falhar com motivo
 * nomeado deixa o chamador registrar o problema em vez de gravar plano nulo.
 */
export function planoPorQtdClientes(qtd: number, planos: PlanoFaixa[]): ResultadoFaixa {
  if (!Number.isInteger(qtd) || qtd < 0) return { ok: false, motivo: 'qtd_invalida' };

  const achado = planos.find((p) =>
    p.ativo &&
    qtd >= (p.clientes_min ?? 0) &&
    (p.clientes_max === null || qtd <= p.clientes_max),
  );

  return achado ? { ok: true, planoId: achado.id } : { ok: false, motivo: 'sem_faixa' };
}
