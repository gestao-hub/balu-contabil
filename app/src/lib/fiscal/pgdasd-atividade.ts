import type { AnexoSimples } from './regime';

/**
 * idAtividade do PGDAS-D (caso comum: município próprio, sem ST, sem retenção de ISS).
 * Fator R → 11 (a SERPRO decide Anexo III↔V via folhasSalario). Ver
 * docs/investigations/PGDAS-D-TRANSDECLARACAO11.md p/ o catálogo completo (43 códigos).
 */
export function idAtividadePadrao(anexoBase: AnexoSimples | null, fatorR: boolean): number {
  if (fatorR) return 11;
  switch (anexoBase) {
    case 'Anexo I': return 1;
    case 'Anexo II': return 4;
    case 'Anexo III': return 14;
    case 'Anexo IV': return 17;
    case 'Anexo V': return 11;
    default: return 1;
  }
}
