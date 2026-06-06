// Builder puro do `dados` do DASN-SIMEI / TRANSDECLARACAO151 (declaração anual do MEI).
// Sem rede/Supabase. Ver docs/investigations/DASN-SIMEI.md.

export type DasnSimeiInput = {
  cnpj: string; // com ou sem máscara
  anoCalendario: number; // ex.: 2025
  valorReceitaComercio: number; // comércio + indústria + transporte de cargas
  valorReceitaServico: number; // serviços + locação
  indicadorEmpregado: boolean;
};

/** Monta o objeto `dados` (o caller faz JSON.stringify ao montar o envelope). */
export function montarDasnSimei(input: DasnSimeiInput): Record<string, unknown> {
  return {
    cnpjCompleto: input.cnpj.replace(/\D+/g, ''),
    anoCalendario: String(input.anoCalendario),
    declaracao: {
      valorReceitaComercio: input.valorReceitaComercio,
      valorReceitaServico: input.valorReceitaServico,
      indicadorEmpregado: input.indicadorEmpregado,
    },
  };
}
