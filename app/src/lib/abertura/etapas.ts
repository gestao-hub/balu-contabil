// @custom — Etapas do processo de abertura (linha do tempo), compartilhadas entre
// a fila/detalhe do contador. Espelha a ordem usada na AberturaInfoView do empresário.
export const ETAPAS = [
  'recebido', 'em_analise', 'pendente_documentos',
  'enviado_receita', 'enviado_junta', 'enviado_prefeitura', 'concluido',
] as const;

export const ETAPA_LABEL: Record<string, string> = {
  recebido: 'Recebido',
  em_analise: 'Em análise',
  pendente_documentos: 'Documentos pendentes',
  enviado_receita: 'Enviado à Receita',
  enviado_junta: 'Na Junta Comercial',
  enviado_prefeitura: 'Na Prefeitura',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export function etapaLabel(etapa: string | null | undefined): string {
  return ETAPA_LABEL[etapa ?? 'recebido'] ?? String(etapa ?? '—');
}
