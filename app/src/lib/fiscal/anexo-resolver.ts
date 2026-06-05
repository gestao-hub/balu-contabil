import type { AnexoSimples } from './regime';
import type { FatorRResult } from './fator-r';

// Registro de cnae_anexo do CNAE principal (null = não mapeado).
export type CnaeAnexoRef = { codigo: string; anexo_base: AnexoSimples | null; fator_r: boolean } | null;

export type AnexoResolvido = {
  anexo: AnexoSimples | null;
  origem: 'cnae' | 'manual' | 'fator_r';
  fatorR?: number | null;
  aviso?: string;
};

/**
 * Decide o anexo da apuração a partir do CNAE principal:
 *  - mapeado, anexo_base definido, sem Fator R → usa o catálogo;
 *  - sujeito a Fator R + cálculo suficiente → crava III ou V (origem 'fator_r');
 *  - sujeito a Fator R sem cálculo → cai no manual + aviso pedindo a folha;
 *  - não mapeado / sem CNAE → cai no manual + aviso.
 * `anexoManual` é o empresas_fiscais.anexo_simples (override/fallback).
 */
export function resolverAnexo(params: {
  cnaePrincipal: string | null;
  cnaeAnexo: CnaeAnexoRef;
  anexoManual: AnexoSimples | null;
  fatorR?: FatorRResult | null;
}): AnexoResolvido {
  const { cnaePrincipal, cnaeAnexo, anexoManual, fatorR } = params;
  if (cnaeAnexo && cnaeAnexo.anexo_base && !cnaeAnexo.fator_r) {
    return { anexo: cnaeAnexo.anexo_base, origem: 'cnae' };
  }
  if (cnaeAnexo && cnaeAnexo.fator_r) {
    if (fatorR && fatorR.suficiente && fatorR.anexoDecidido) {
      return {
        anexo: fatorR.anexoDecidido,
        origem: 'fator_r',
        fatorR: fatorR.fatorR,
        aviso: `Fator R = ${((fatorR.fatorR ?? 0) * 100).toFixed(1)}% → ${fatorR.anexoDecidido}.`,
      };
    }
    return {
      anexo: anexoManual,
      origem: 'manual',
      aviso: 'Informe a folha dos últimos 12 meses para calcular o Fator R (Anexo III ou V).',
    };
  }
  if (!cnaePrincipal) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Sem CNAE principal — usando anexo informado.' };
  }
  return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
}
