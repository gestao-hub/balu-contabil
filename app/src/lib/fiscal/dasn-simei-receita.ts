// Soma a receita anual do MEI em comércio × serviço, classificando por TIPO de nota.
// NFSe → serviço; NFe/NFCe → comércio. Puro. Ver docs/investigations/DASN-SIMEI.md.
import { assertTipoDoc } from './notas-tipo';

export type NotaReceita = { tipo: string; valor: number };
export type ReceitaAnualMei = { comercio: number; servico: number };

export function somarReceitaAnualMei(notas: NotaReceita[]): ReceitaAnualMei {
  const acc: ReceitaAnualMei = { comercio: 0, servico: 0 };
  for (const nota of notas) {
    const tipo = assertTipoDoc(nota.tipo); // tipo desconhecido lança
    const valor = typeof nota.valor === 'number' && Number.isFinite(nota.valor) ? nota.valor : 0;
    if (tipo === 'NFSe') acc.servico += valor;
    else acc.comercio += valor; // NFe | NFCe
  }
  return acc;
}
