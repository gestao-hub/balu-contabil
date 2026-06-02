// DAS-MEI: INSS 5% do salário mínimo + ICMS (R$1) e/ou ISS (R$5).
// Base: salário mínimo R$ 1.518 (2025) → INSS R$ 75,90.
// CONFERIR e atualizar quando o salário mínimo de 2026 for oficial.
const DAS_MEI_2026 = {
  'Comercio ou Industria': 76.90, // 75,90 + 1,00 ICMS
  'Prestacao de Servicos': 80.90, // 75,90 + 5,00 ISS
  'Comercio e Servicos': 81.90,   // 75,90 + 1,00 + 5,00
} as const;

export function valorDasMei(atividade: string | null | undefined): number {
  if (atividade && atividade in DAS_MEI_2026) {
    return DAS_MEI_2026[atividade as keyof typeof DAS_MEI_2026];
  }
  return DAS_MEI_2026['Prestacao de Servicos'];
}
