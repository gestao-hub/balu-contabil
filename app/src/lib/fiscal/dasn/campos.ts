// src/lib/fiscal/dasn/campos.ts
// Os três campos da DASN-SIMEI: validação, sugestão a partir das notas e a
// ponte para o builder de payload SERPRO que já existia sem caller.
import { z } from 'zod';
import { montarDasnSimei } from '../dasn-simei';
import type { ResumoReceitas } from '../declaracoes-anuais/tipos';

export const DasnCamposSchema = z.object({
  receitaComercio: z.number().min(0, 'A receita de comércio não pode ser negativa.'),
  receitaServico: z.number().min(0, 'A receita de serviço não pode ser negativa.'),
  possuiEmpregado: z.boolean(),
});

export type DasnCampos = z.infer<typeof DasnCamposSchema>;

/** Rascunho da DASN: nada obrigatório, mesmo motivo do DEFIS (ver defis/campos.ts). */
export const DasnRascunhoSchema = DasnCamposSchema.partial();

const ROTULOS_DASN: Record<string, string> = {
  receitaComercio: 'Receita de comércio e indústria',
  receitaServico: 'Receita de serviços',
  possuiEmpregado: 'Teve empregado no ano',
};

/** Nome de tela de um campo da DASN, a partir do caminho do erro do Zod. */
export function rotuloCampoDasn(caminho: readonly (string | number)[]): string {
  const chave = caminho[0];
  return typeof chave === 'string' ? ROTULOS_DASN[chave] ?? chave : '';
}

/**
 * Sugestão pré-preenchida. O usuário PODE corrigir para o valor que de fato vai
 * declarar — a diferença vira alerta de divergência, nunca bloqueio (spec §5.2).
 * `possuiEmpregado` começa false: o app não tem folha para inferir isso.
 */
export function sugerirCampos(resumo: ResumoReceitas): DasnCampos {
  return {
    receitaComercio: resumo.comercio,
    receitaServico: resumo.servico,
    possuiEmpregado: false,
  };
}

/** Payload do TRANSDECLARACAO151 — usado hoje só para conferência/consulta. */
export function paraPayloadSerpro(campos: DasnCampos, cnpj: string, ano: number): Record<string, unknown> {
  return montarDasnSimei({
    cnpj,
    anoCalendario: ano,
    valorReceitaComercio: campos.receitaComercio,
    valorReceitaServico: campos.receitaServico,
    indicadorEmpregado: campos.possuiEmpregado,
  });
}
