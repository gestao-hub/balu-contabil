// src/lib/fiscal/declaracoes-anuais/divergencia.ts
// Compara o valor DECLARADO pelo usuário com o APURADO a partir das notas.
// Nunca bloqueia: o resultado vira alerta na UI (spec §5.2, premissa 5).

export type Divergencia = {
  /** declarado − apurado. Positivo = declarou mais do que as notas mostram. */
  diferenca: number;
  ha: boolean;
  sentido: 'acima' | 'abaixo' | 'confere';
};

/** Tolerância de 1 centavo: resíduo de soma em float não é divergência. */
const TOLERANCIA = 0.01;

export function calcularDivergencia(declarado: number, apurado: number): Divergencia {
  const diferenca = declarado - apurado;
  if (Math.abs(diferenca) <= TOLERANCIA) return { diferenca: 0, ha: false, sentido: 'confere' };
  return { diferenca, ha: true, sentido: diferenca > 0 ? 'acima' : 'abaixo' };
}
