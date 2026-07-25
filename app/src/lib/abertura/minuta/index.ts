// src/lib/abertura/minuta/index.ts
// Seletor do documento correto por tipo de empresa + validação de campos mínimos.
// O documento gerado depende de empresa_tipo — MEI NÃO gera "contrato social".

export type TipoDocMinuta = 'roteiro_mei' | 'requerimento_empresario' | 'ato_constitutivo_slu';

export function tipoDocumento(empresaTipo: string): TipoDocMinuta {
  if (empresaTipo === 'MEI') return 'roteiro_mei';
  if (empresaTipo === 'EI') return 'requerimento_empresario';
  return 'ato_constitutivo_slu'; // LTDA / SLU
}

export type MinutaInput = {
  empresa_tipo: string;
  titular_nome_completo?: string | null;
  empresa_razao_social_1?: string | null;
  empresa_objeto_social?: string | null;
  empresa_capital_social?: number | null;
};

/** Campos mínimos por tipo. Capital social só é exigido fora do MEI. */
export function minutaPronta(ab: MinutaInput): { ok: boolean; faltando: string[] } {
  const faltando: string[] = [];
  if (!ab.titular_nome_completo) faltando.push('titular_nome_completo');
  if (!ab.empresa_razao_social_1) faltando.push('empresa_razao_social_1');
  if (!ab.empresa_objeto_social) faltando.push('empresa_objeto_social');
  if (ab.empresa_tipo !== 'MEI' && ab.empresa_capital_social == null) faltando.push('empresa_capital_social');
  return { ok: faltando.length === 0, faltando };
}
