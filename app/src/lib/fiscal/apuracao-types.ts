// Tipos normalizados da apuração. O núcleo de cálculo consome ReceitaApuracao[]
// e não conhece a origem dos dados (notas_fiscais vs receitas_fiscais).

/** Uma receita já normalizada para apuração. competencia em YYYYMM. */
export type ReceitaApuracao = {
  competencia: string; // "YYYYMM"
  valor: number;       // R$ (receita bruta do documento)
};

export type ResultadoApuracao = {
  tipoApuracao: 'DAS-MEI' | 'Simples Nacional';
  competencia: string;            // "YYYYMM"
  receitaMes: number;             // receita bruta da própria competência
  rbt12: number | null;           // null para MEI
  aliquotaEfetiva: number | null; // null para MEI; fração (0.0433 = 4,33%)
  valorImposto: number;
  breakdown: Record<string, unknown>; // vira payload_calculo
};

export type PreviewImposto =
  | { tipo: 'simples'; aliquota: number }   // alíquota efetiva 0..1
  | { tipo: 'mei'; valorFixo: number }       // DAS fixo mensal
  | { tipo: 'indisponivel' };                // Regime Normal / sem anexo / sem regime
