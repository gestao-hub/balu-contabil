// src/lib/fiscal/declaracoes-anuais/tipos.ts
// Tipos compartilhados pelas duas declarações anuais (DASN-SIMEI e DEFIS).
// Convenção: toda chave de campo é camelCase — inclusive dentro do jsonb `dados`.

export type DeclaracaoAnualTipo = 'DASN-SIMEI' | 'DEFIS';

/** Nota lida do banco, já normalizada. */
export type NotaReceita = {
  dataEmissao: string;                        // ISO
  valor: number;
  tipoDocumento: 'NFSe' | 'NFe' | 'NFCe';
};

/** Receita agregada de um ano-calendário. */
export type ResumoReceitas = {
  comercio: number;
  servico: number;
  total: number;
  qtdNotas: number;
};

export type ComprovanteInput = {
  nome: string;
  mime: string;
  bytes: Buffer;
};

export type RegistroInput = {
  companyId: string;
  ownerUserId: string;
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  /** null (ou ausente) = rascunho: NÃO cala o aviso do sino. */
  dataTransmissao?: string | null;            // 'YYYY-MM-DD'
  numeroDeclaracao?: string | null;
  divergenciaReceita?: number | null;
  origem: 'serpro' | 'manual';
  registradoPor: string;
  comprovante?: ComprovanteInput | null;
};

export type ResultadoRegistro = { ok: true; id: string } | { ok: false; error: string };

/** Prefixo da chave de notificação que este tipo de declaração silencia. */
export const TIPO_AVISO: Record<DeclaracaoAnualTipo, string> = {
  'DASN-SIMEI': 'dasn_pendente',
  DEFIS: 'defis_pendente',
};
