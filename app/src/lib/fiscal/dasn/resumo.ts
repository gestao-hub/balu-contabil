// src/lib/fiscal/dasn/resumo.ts
// Agregação pura do ano-calendário + teste do limite do MEI.
// Puro de propósito: a borda do ano em BRT é a parte fácil de errar, e aqui ela
// é testável sem banco. A leitura das notas fica em receitas-source.ts.
import type { NotaReceita, ResumoReceitas } from '../declaracoes-anuais/tipos';
import { ymdBrt } from '../tempo-brt';

/** Ano-calendário de uma data, no fuso de Brasília — mesma régua de `ymdBrt`. */
function anoBrt(iso: string): number {
  return Number(ymdBrt(new Date(iso)).slice(0, 4));
}

/**
 * Soma as notas do ano-calendário, separando por natureza da receita.
 * NFSe → serviço (inclui locação); NFe e NFCe → comércio (inclui indústria).
 * Ver premissa 4 da spec: a separação é por tipo de documento, não por CNAE.
 */
export function resumirReceitasAno(notas: NotaReceita[], ano: number): ResumoReceitas {
  const doAno = notas.filter((n) => anoBrt(n.dataEmissao) === ano);
  let comercio = 0;
  let servico = 0;
  for (const n of doAno) {
    if (n.tipoDocumento === 'NFSe') servico += n.valor;
    else comercio += n.valor;
  }
  return {
    comercio: arredondar(comercio),
    servico: arredondar(servico),
    total: arredondar(comercio + servico),
    qtdNotas: doAno.length,
  };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/** LC 123/2006, art. 18-A, §1º. */
export const LIMITE_MEI_ANUAL = 81000;
const LIMITE_COM_TOLERANCIA = LIMITE_MEI_ANUAL * 1.2;

export type AvaliacaoLimite = {
  total: number;
  excede: boolean;
  /** Acima de 20% do limite: o desenquadramento retroage ao início do ano. */
  excedeEm20Pct: boolean;
  excedente: number;
};

export function avaliarLimiteMei(total: number): AvaliacaoLimite {
  const excede = total > LIMITE_MEI_ANUAL;
  return {
    total,
    excede,
    excedeEm20Pct: total > LIMITE_COM_TOLERANCIA,
    excedente: excede ? arredondar(total - LIMITE_MEI_ANUAL) : 0,
  };
}
