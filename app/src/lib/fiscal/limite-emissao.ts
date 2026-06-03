// Preview do limite de emissão por regime. Base legal do "estouro": faturamento
// do ano-calendário. MEI = R$81.000/ano; Simples = R$4.800.000/ano; Regime Normal
// (Lucro Real/Presumido) não tem teto → banner oculto.

export type NivelLimite = 'verde' | 'amarelo' | 'vermelho';

export type LimiteEmissao =
  | { mostrar: false }
  | { mostrar: true; limite: number; total: number; pct: number; nivel: NivelLimite; ano: number };

const LIMITE_MEI = 81000;
const LIMITE_SIMPLES = 4800000;

export function limitePorRegime(code: string | null | undefined): number | null {
  if (code === '4') return LIMITE_MEI;                 // MEI
  if (code === '1' || code === '2') return LIMITE_SIMPLES; // Simples (incl. excesso de sublimite)
  return null;                                          // Regime Normal (3) / desconhecido
}

export function nivelPorPct(pct: number): NivelLimite {
  if (pct <= 60) return 'verde';
  if (pct <= 80) return 'amarelo';
  return 'vermelho';
}

export function calcularLimiteEmissao(
  code: string | null | undefined,
  total: number,
  ano: number,
): LimiteEmissao {
  const limite = limitePorRegime(code);
  if (limite == null) return { mostrar: false };
  const pct = limite > 0 ? Math.round((total / limite) * 100) : 0;
  return { mostrar: true, limite, total, pct, nivel: nivelPorPct(pct), ano };
}
