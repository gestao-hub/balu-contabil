import type { AnexoSimples } from './regime';

export type FaixaSimples = { faixa: number; ate: number; nominal: number; deduzir: number };

export type TabelaSimples = Record<AnexoSimples, FaixaSimples[]>;

// LC 123/2006 (redação LC 155/2016). nominal em fração; ate/deduzir em R$.
//
// FALLBACK, não fonte da verdade (desde 12/08/2026). A tabela vigente vem de
// `parametros_fiscais` (chave `tabela_simples`, com vigência), lida em
// `lib/fiscal/parametros.ts`. Isto aqui é o que resta quando o banco não
// responde — e é o mesmo conteúdo que a 0079 semeou, então o cálculo não muda
// de resultado por causa da origem.
//
// Continua no código de propósito: cair para "sem tabela" não é opção. Um
// SELECT que falha não pode virar imposto zerado nem tela vazia; vira o mesmo
// número de sempre, com a divergência aparecendo no log e não no DAS.
export const TABELA_SIMPLES_FALLBACK: TabelaSimples = {
  'Anexo I': [
    { faixa: 1, ate: 180000, nominal: 0.04, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.073, deduzir: 5940 },
    { faixa: 3, ate: 720000, nominal: 0.095, deduzir: 13860 },
    { faixa: 4, ate: 1800000, nominal: 0.107, deduzir: 22500 },
    { faixa: 5, ate: 3600000, nominal: 0.143, deduzir: 87300 },
    { faixa: 6, ate: 4800000, nominal: 0.19, deduzir: 378000 },
  ],
  'Anexo II': [
    { faixa: 1, ate: 180000, nominal: 0.045, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.078, deduzir: 5940 },
    { faixa: 3, ate: 720000, nominal: 0.10, deduzir: 13860 },
    { faixa: 4, ate: 1800000, nominal: 0.112, deduzir: 22500 },
    { faixa: 5, ate: 3600000, nominal: 0.147, deduzir: 85500 },
    { faixa: 6, ate: 4800000, nominal: 0.30, deduzir: 720000 },
  ],
  'Anexo III': [
    { faixa: 1, ate: 180000, nominal: 0.06, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.112, deduzir: 9360 },
    { faixa: 3, ate: 720000, nominal: 0.135, deduzir: 17640 },
    { faixa: 4, ate: 1800000, nominal: 0.16, deduzir: 35640 },
    { faixa: 5, ate: 3600000, nominal: 0.21, deduzir: 125640 },
    { faixa: 6, ate: 4800000, nominal: 0.33, deduzir: 648000 },
  ],
  'Anexo IV': [
    { faixa: 1, ate: 180000, nominal: 0.045, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.09, deduzir: 8100 },
    { faixa: 3, ate: 720000, nominal: 0.102, deduzir: 12420 },
    { faixa: 4, ate: 1800000, nominal: 0.14, deduzir: 39780 },
    { faixa: 5, ate: 3600000, nominal: 0.22, deduzir: 183780 },
    { faixa: 6, ate: 4800000, nominal: 0.33, deduzir: 828000 },
  ],
  'Anexo V': [
    { faixa: 1, ate: 180000, nominal: 0.155, deduzir: 0 },
    { faixa: 2, ate: 360000, nominal: 0.18, deduzir: 4500 },
    { faixa: 3, ate: 720000, nominal: 0.195, deduzir: 9900 },
    { faixa: 4, ate: 1800000, nominal: 0.205, deduzir: 17100 },
    { faixa: 5, ate: 3600000, nominal: 0.23, deduzir: 62100 },
    { faixa: 6, ate: 4800000, nominal: 0.305, deduzir: 540000 },
  ],
};

/**
 * A tabela a usar: a que o chamador leu do banco, ou o fallback.
 *
 * A competência não escolhe mais nada aqui — quem escolhe por vigência é o
 * SELECT em `parametros_fiscais`, que é onde a data mora. O parâmetro fica
 * porque a assinatura já era essa e porque é ele que documenta, no ponto de
 * uso, que o cálculo é datado.
 */
export function getTabelaSimples(_competencia: string, tabela?: TabelaSimples | null): TabelaSimples {
  return tabela ?? TABELA_SIMPLES_FALLBACK;
}

/** Primeira faixa cujo teto cobre o RBT12; acima do teto, última faixa. */
export function identificarFaixa(
  rbt12: number,
  anexo: AnexoSimples,
  competencia = '202601',
  tabela?: TabelaSimples | null,
): FaixaSimples {
  const faixas = getTabelaSimples(competencia, tabela)[anexo];
  return faixas.find((f) => rbt12 <= f.ate) ?? faixas[faixas.length - 1];
}

/** Alíquota efetiva = ((RBT12 * nominal) - dedução) / RBT12, com clamp em 0. */
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (rbt12 <= 0) return 0;
  return Math.max(0, (rbt12 * faixa.nominal - faixa.deduzir) / rbt12);
}
