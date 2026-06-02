import type { ReceitaApuracao } from './apuracao-types';
import { competenciaAddMonths } from './guia';

function compIndex(comp: string): number {
  const r = comp.padStart(6, '0');
  return Number(r.slice(0, 4)) * 12 + (Number(r.slice(4, 6)) - 1);
}

/**
 * RBT12 = receita bruta dos 12 meses imediatamente anteriores à competência
 * (exclui a própria competência). Anualiza se a empresa tem < 12 meses de atividade.
 */
export function calcularRbt12(
  receitas: ReceitaApuracao[],
  competencia: string,
  dataInicioAtividade?: string,
): { rbt12: number; mesesConsiderados: number; anualizado: boolean } {
  const inicio = competenciaAddMonths(competencia, -12); // 12 meses antes
  const fim = competenciaAddMonths(competencia, -1);      // mês anterior (exclui a atual)
  const somaReal = receitas
    .filter((r) => r.competencia >= inicio && r.competencia <= fim)
    .reduce((acc, r) => acc + r.valor, 0);

  let mesesConsiderados = 12;
  if (dataInicioAtividade) {
    const d = new Date(dataInicioAtividade);
    const inicioAtivIdx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const startIdx = Math.max(compIndex(inicio), inicioAtivIdx);
    const endIdx = compIndex(fim);
    mesesConsiderados = Math.min(12, Math.max(1, endIdx - startIdx + 1));
  }

  const anualizado = mesesConsiderados < 12;
  const rbt12 = anualizado ? (somaReal * 12) / mesesConsiderados : somaReal;
  return { rbt12: Number(rbt12.toFixed(2)), mesesConsiderados, anualizado };
}
