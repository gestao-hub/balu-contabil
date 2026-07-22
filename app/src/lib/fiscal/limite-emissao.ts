// Preview do limite de emissão por regime. Base legal do "estouro": faturamento
// do ano-calendário. MEI = R$81.000/ano; Simples = R$4.800.000/ano; Regime Normal
// (Lucro Real/Presumido) não tem teto → banner oculto.

export type NivelLimite = 'verde' | 'amarelo' | 'vermelho';

export type LimiteEmissao =
  | { mostrar: false }
  | { mostrar: true; limite: number; total: number; pct: number; nivel: NivelLimite; ano: number };

// Fallback apenas — os tetos vigentes vêm de parametros_fiscais (ver src/lib/fiscal/parametros.ts).
// Nunca hard-codar: a LC 123/2006 pode ser reajustada por lei.
const LIMITE_MEI = 81000;
const LIMITE_SIMPLES = 4800000;

export function limitePorRegime(
  code: string | null | undefined,
  limites: { mei: number; simples: number } = { mei: LIMITE_MEI, simples: LIMITE_SIMPLES },
): number | null {
  if (code === '4') return limites.mei;                 // MEI
  if (code === '1' || code === '2') return limites.simples; // Simples (incl. excesso de sublimite)
  return null;                                           // Regime Normal (3) / desconhecido
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
  limites?: { mei: number; simples: number },
): LimiteEmissao {
  const limite = limitePorRegime(code, limites);
  if (limite == null) return { mostrar: false };
  const pct = limite > 0 ? Math.round((total / limite) * 100) : 0;
  return { mostrar: true, limite, total, pct, nivel: nivelPorPct(pct), ano };
}
