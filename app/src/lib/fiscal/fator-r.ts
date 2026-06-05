export const LIMIAR_FATOR_R = 0.28;

export type FatorRResult = {
  fatorR: number | null;                          // razão 0..1 (null se insuficiente)
  anexoDecidido: 'Anexo III' | 'Anexo V' | null;
  suficiente: boolean;
};

/**
 * Fator R = folha (12m) ÷ RBT12. >= 28% → Anexo III, senão Anexo V.
 * Insuficiente (não decide) quando rbt12 <= 0 ou folha12m <= 0 — o chamador cai no manual.
 */
export function calcularFatorR(input: { folha12m: number; rbt12: number }): FatorRResult {
  const { folha12m, rbt12 } = input;
  if (rbt12 <= 0 || folha12m <= 0) {
    return { fatorR: null, anexoDecidido: null, suficiente: false };
  }
  const fatorR = folha12m / rbt12;
  const anexoDecidido = fatorR >= LIMIAR_FATOR_R ? 'Anexo III' : 'Anexo V';
  return { fatorR, anexoDecidido, suficiente: true };
}
