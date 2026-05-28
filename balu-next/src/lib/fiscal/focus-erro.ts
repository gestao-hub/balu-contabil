// @custom — PR 2.1 — Tradutor + extractor de mensagens de erro da Focus.
// Helpers puros, sem deps externas. Testáveis isoladamente.

/**
 * Cobre os erros mais comuns (cert, 401/403, prefeitura fora, timeout,
 * código de tributação inválido). Resto fica com prefixo "Erro Focus:".
 *
 * Importante: o fallback faz um slice de 250 chars pra não vazar payloads
 * inteiros na UI. Mensagens originais da Focus tipo
 * `Focus POST /v2/nfsen → 422: <body>` são limpas do prefixo do path.
 */
export function traduzirErroFocus(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('access denied')) {
    return 'Token da empresa na Focus inválido ou expirado. Vá no Diagnóstico e clique em "Sincronizar com Focus" pra renovar.';
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return 'Sem permissão na Focus. Verifique se a empresa está habilitada para NFS-e.';
  }
  if (lower.includes('cnpj') && (lower.includes('inválido') || lower.includes('invalido'))) {
    return 'CNPJ inválido — confira os dados do tomador.';
  }
  if (lower.includes('certificado') && (lower.includes('expirado') || lower.includes('vencido'))) {
    return 'Certificado A1 expirado. Suba um novo certificado na aba "Emissão fiscal".';
  }
  if (lower.includes('certificado')) {
    return 'Problema no certificado A1. Verifique no Diagnóstico.';
  }
  if (lower.includes('prefeitura') || lower.includes('webservice') || lower.includes('ws-')) {
    return 'A prefeitura está fora do ar agora. Tente em alguns minutos.';
  }
  if (lower.includes('timeout') || lower.includes('etimedout')) {
    return 'Tempo esgotado conversando com a Focus. Tente novamente em instantes.';
  }
  if (lower.includes('codigo_tributacao') || lower.includes('código de tributação')) {
    return 'Código de tributação inválido para a NFSe Nacional. Confira o código (6 dígitos).';
  }
  if (lower.includes('campo') && lower.includes('obrigat')) {
    // Costuma vir do Focus: "O campo dfe.X é obrigatório."
    return `Falta um campo obrigatório. Detalhe: ${raw.slice(0, 200)}`;
  }
  // Fallback: corta pra não vazar payload na UI.
  const stripped = raw.replace(/^Focus [A-Z]+ \/v2\/\S+ → \d+:\s*/, '').slice(0, 250);
  return `Erro Focus: ${stripped}`;
}

/**
 * Extrai mensagem de erro de uma nota a partir do `payload_focusnfe` salvo
 * no banco. A estrutura varia por tipo de documento e momento:
 *
 *   - DPS Nacional (NFSe): callback.erros[0].mensagem (+ codigo)
 *   - NFe/NFCe legacy:     callback.mensagem
 *   - Erro síncrono (ex: 401 no POST inicial): payload.error
 *
 * Retorna null quando não há nada útil (cliente pode mostrar fallback genérico).
 */
export function extrairMensagemErro(
  payload: Record<string, unknown>,
): { msg: string; codigo: string | null } | null {
  const callback = payload.callback as Record<string, unknown> | undefined;
  if (callback) {
    const erros = callback.erros as Array<{ codigo?: string; mensagem?: string }> | undefined;
    if (erros && erros.length > 0 && erros[0]?.mensagem) {
      return { msg: erros[0].mensagem, codigo: erros[0].codigo ?? null };
    }
    if (typeof callback.mensagem === 'string' && callback.mensagem.trim()) {
      return { msg: callback.mensagem, codigo: null };
    }
  }
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return { msg: payload.error, codigo: null };
  }
  return null;
}
