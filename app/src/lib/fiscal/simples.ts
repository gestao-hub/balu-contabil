import type { AnexoSimples } from './regime';

export type FaixaSimples = { faixa: number; ate: number; nominal: number; deduzir: number };

// LC 123/2006 (redação LC 155/2016). nominal em fração; ate/deduzir em R$.
const TABELA_SIMPLES_2026: Record<AnexoSimples, FaixaSimples[]> = {
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

/** Retorna a tabela vigente para a competência. Hoje só 2026; versionar quando entrar LC 214/2025. */
export function getTabelaSimples(_competencia: string): Record<AnexoSimples, FaixaSimples[]> {
  return TABELA_SIMPLES_2026;
}

/** Primeira faixa cujo teto cobre o RBT12; acima do teto, última faixa. */
export function identificarFaixa(rbt12: number, anexo: AnexoSimples, competencia = '202601'): FaixaSimples {
  const tabela = getTabelaSimples(competencia)[anexo];
  return tabela.find((f) => rbt12 <= f.ate) ?? tabela[tabela.length - 1];
}

/** Alíquota efetiva = ((RBT12 * nominal) - dedução) / RBT12, com clamp em 0. */
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (rbt12 <= 0) return 0;
  return Math.max(0, (rbt12 * faixa.nominal - faixa.deduzir) / rbt12);
}
