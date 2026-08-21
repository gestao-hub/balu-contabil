// Sugestão de próximo número de versão para "Salvar como nova versão".
// Puro de propósito: usado tanto no servidor (se um dia precisar) quanto no
// Client Component do editor, sem trazer nada do Supabase junto.
//
// Só INCREMENTA o padrão mais comum aqui (major.minor, ex.: "1.0" → "1.1").
// Qualquer outro formato devolve string vazia — é melhor o admin digitar a
// versão nova do que a tela "adivinhar" um número que não faz sentido.
export function sugerirProximaVersao(versaoAtual: string): string {
  const m = /^(\d+)\.(\d+)$/.exec(versaoAtual.trim());
  if (!m) return '';
  const major = m[1];
  const minor = Number(m[2]) + 1;
  return `${major}.${minor}`;
}
