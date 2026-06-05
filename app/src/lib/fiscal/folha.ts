import { competenciaAddMonths } from './guia';

export type FolhaMensal = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

/**
 * Soma a folha (pró-labore + salários + encargos) dos 12 meses imediatamente anteriores à
 * competência (exclui a própria), mesma janela do RBT12. `meses` = competências com soma > 0.
 */
export function somarFolha12(
  folhas: FolhaMensal[],
  competencia: string,
): { folha12m: number; meses: number } {
  const inicio = competenciaAddMonths(competencia, -12);
  const fim = competenciaAddMonths(competencia, -1);
  let folha12m = 0;
  let meses = 0;
  for (const item of folhas) {
    if (item.competencia < inicio || item.competencia > fim) continue;
    const total = item.proLabore + item.salarios + item.encargos;
    folha12m += total;
    if (total > 0) meses += 1;
  }
  return { folha12m: Number(folha12m.toFixed(2)), meses };
}
