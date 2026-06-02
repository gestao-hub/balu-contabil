// @custom — Mapeamento de status Focus → status canônico do Balu.
// Helper puro, testável. Compartilhado entre webhook e qualquer outro consumer
// que precise traduzir o vocabulário da Focus.
//
// Statuses internos (alinhados com `notas_fiscais.status` + emitirNotaAction):
//   - 'pendente'  → em processamento (default antes do callback)
//   - 'ativa'     → autorizada na SEFAZ/Receita
//   - 'cancelada' → cancelada ou inutilizada
//   - 'erro'      → denegada, rejeitada, qualquer falha de validação

export type StatusBalu = 'pendente' | 'ativa' | 'cancelada' | 'erro';

export function mapStatusFocus(focusStatus: string | undefined | null): StatusBalu {
  const s = (focusStatus ?? '').toLowerCase();
  if (s.includes('autorizado') || s.includes('autorizada')) return 'ativa';
  if (s.includes('cancelado') || s.includes('cancelada')) return 'cancelada';
  if (s.includes('inutilizado') || s.includes('inutilizada')) return 'cancelada';
  if (s.includes('denegado') || s.includes('denegada')) return 'erro';
  if (s.includes('rejeitado') || s.includes('rejeitada')) return 'erro';
  if (s.includes('erro')) return 'erro';
  // 'processando_autorizacao', 'em_processamento', vazio → mantém pendente
  return 'pendente';
}
