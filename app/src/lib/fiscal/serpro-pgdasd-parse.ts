export type DeclaracaoPgdasdResult = {
  transmitida: boolean;
  numeroDeclaracao: string | null;
  dataHoraTransmissao: string | null;
  valorTotalDevido: number | null;
  tributos: Array<{ codigo: number; nome: string; valor: number }>;
  mensagens: string[];
};

const NOME_TRIBUTO: Record<number, string> = {
  1001: 'IRPJ', 1002: 'CSLL', 1004: 'COFINS', 1005: 'PIS',
  1006: 'INSS/CPP', 1007: 'ICMS', 1008: 'IPI', 1010: 'ISS',
};

/** Parseia o envelope do TRANSDECLARACAO11. Lança em formato inesperado (loga). */
export function parseDeclaracaoPgdasd(resp: unknown): DeclaracaoPgdasdResult {
  const env = resp as { dados?: unknown; mensagens?: Array<{ codigo?: string; texto?: string }> };
  if (!env || typeof env.dados !== 'string') {
    console.error('[parseDeclaracaoPgdasd] formato inesperado:', JSON.stringify(resp)?.slice(0, 300));
    throw new Error('Resposta da declaração em formato inesperado.');
  }
  let dados: {
    idDeclaracao?: string; dataHoraTransmissao?: string;
    valoresDevidos?: Array<{ codigoTributo?: number; valor?: number }>;
  };
  try {
    dados = JSON.parse(env.dados);
  } catch {
    console.error('[parseDeclaracaoPgdasd] dados não-JSON:', env.dados.slice(0, 300));
    throw new Error('Resposta da declaração em formato inesperado (dados).');
  }

  const tributos = (dados.valoresDevidos ?? [])
    .filter((t) => t.codigoTributo != null && t.valor != null)
    .map((t) => ({ codigo: t.codigoTributo as number, nome: NOME_TRIBUTO[t.codigoTributo as number] ?? `Tributo ${t.codigoTributo}`, valor: Number(t.valor) }));
  const valorTotalDevido = tributos.length
    ? Number(tributos.reduce((acc, t) => acc + t.valor, 0).toFixed(2))
    : null;
  const numeroDeclaracao = dados.idDeclaracao ?? null;

  return {
    transmitida: !!numeroDeclaracao,
    numeroDeclaracao,
    dataHoraTransmissao: dados.dataHoraTransmissao ?? null,
    valorTotalDevido,
    tributos,
    mensagens: (env.mensagens ?? []).map((m) => m.texto ?? '').filter(Boolean),
  };
}
