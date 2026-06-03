// Helper puro compartilhado entre as emissões de DAS (Simples e MEI).
// Detecta "nada devido": a Serpro responde 200 com dados vazio e/ou mensagem MSG_E0139
// ("Não foi gerado DAS por não haver valor devido para o período informado.").

export function isNadaDevido(resp: unknown): boolean {
  const env = (resp ?? {}) as { dados?: unknown; mensagens?: unknown };
  const msgs = Array.isArray(env.mensagens) ? env.mensagens : [];
  const temE0139 = msgs.some(
    (m) => typeof (m as { codigo?: unknown })?.codigo === 'string' && (m as { codigo: string }).codigo.includes('MSG_E0139'),
  );
  const dadosVazio = env.dados == null || (typeof env.dados === 'string' && env.dados.trim() === '');
  return temE0139 || dadosVazio;
}
