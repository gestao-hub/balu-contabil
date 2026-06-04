import type { AnexoSimples } from './regime';

// Registro de cnae_anexo do CNAE principal (null = não mapeado).
export type CnaeAnexoRef = { codigo: string; anexo_base: AnexoSimples | null; fator_r: boolean } | null;

export type AnexoResolvido = {
  anexo: AnexoSimples | null;
  origem: 'cnae' | 'manual';
  aviso?: string;
};

/**
 * Decide o anexo da apuração a partir do CNAE principal:
 *  - mapeado, anexo_base definido, sem Fator R → usa o catálogo;
 *  - sujeito a Fator R (III↔V indefinido sem cálculo) → cai no manual + aviso;
 *  - não mapeado / sem CNAE → cai no manual + aviso.
 * `anexoManual` é o empresas_fiscais.anexo_simples (override/fallback).
 */
export function resolverAnexo(params: {
  cnaePrincipal: string | null;
  cnaeAnexo: CnaeAnexoRef;
  anexoManual: AnexoSimples | null;
}): AnexoResolvido {
  const { cnaePrincipal, cnaeAnexo, anexoManual } = params;
  if (cnaeAnexo && cnaeAnexo.anexo_base && !cnaeAnexo.fator_r) {
    return { anexo: cnaeAnexo.anexo_base, origem: 'cnae' };
  }
  if (cnaeAnexo && cnaeAnexo.fator_r) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Anexo depende do Fator R — confirmar (III ou V).' };
  }
  if (!cnaePrincipal) {
    return { anexo: anexoManual, origem: 'manual', aviso: 'Sem CNAE principal — usando anexo informado.' };
  }
  return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
}
