// @custom — PR 2.1 — Códigos de tributação ISSQN para NFS-e Nacional.
//
// Padrão Nacional (DPS) usa a "Lista de Serviços Nacional" — 6 dígitos —
// não a LC 116/2003 (formato `X.XX`). Esta lista é mantida pela Receita
// Federal no contexto da Reforma Tributária.
//
// MVP: top-10 mais comuns + opção "Outro" pra código livre. Quando houver
// demanda real, vira tabela `codigos_tributacao_nacional` ou import do CSV
// oficial via cron.

export type CodigoTributacao = {
  codigo: string;   // 6 dígitos no padrão Nacional
  label: string;    // descrição amigável pra UI
};

/** Códigos mais frequentes pro MVP (serviços B2B típicos). */
export const CODIGOS_TRIBUTACAO_FREQUENTES: ReadonlyArray<CodigoTributacao> = [
  { codigo: '010701', label: 'Consultoria em informática' },
  { codigo: '010101', label: 'Análise e desenvolvimento de sistemas' },
  { codigo: '010401', label: 'Programação' },
  { codigo: '010601', label: 'Suporte técnico em TI' },
  { codigo: '170101', label: 'Assessoria e consultoria em geral' },
  { codigo: '170501', label: 'Serviços de contabilidade' },
  { codigo: '170601', label: 'Serviços advocatícios' },
  { codigo: '170801', label: 'Serviços de propaganda e publicidade' },
  { codigo: '060201', label: 'Serviços de manutenção e instalação' },
  { codigo: '140201', label: 'Treinamento e capacitação profissional' },
];

/** Marcador especial pra UI quando o user escolhe "Outro" → input livre. */
export const CODIGO_OUTRO_SENTINEL = 'OUTRO';

/** Valida formato do código (6 dígitos numéricos). */
export function isCodigoTributacaoValido(codigo: string): boolean {
  return /^\d{6}$/.test(codigo);
}
