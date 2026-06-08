// Parser puro da resposta do PAGTOWEB / PAGAMENTOS71 (consulta de DAS pagos).
// Retorna apenas documentos do tipo 9 (DAS). Puro/testável — sem deps de rede/Supabase.

export type PagamentoDas = {
  competencia: string;         // 'YYYYMM' extraído de periodoApuracao
  numeroDocumento: string;
  valorTotal: number | null;
  valorPrincipal: number | null;
  valorMulta: number | null;
  valorJuros: number | null;
  dataVencimento: string | null;  // 'YYYY-MM-DD'
  dataPagamento: string | null;   // 'YYYY-MM-DD' (= dataArrecadacao)
};

/** 'YYYY-MM-DDTHH:...' → 'YYYYMM'. null se inválido. */
function extractCompetencia(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** 'YYYY-MM-DDTHH:...' → 'YYYY-MM-DD'. null se inválido. */
function extractDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePagamentosDas(resp: unknown): PagamentoDas[] {
  const env = resp as { dados?: unknown } | null;
  let dados: unknown;
  try {
    dados = typeof env?.dados === 'string' ? JSON.parse(env.dados) : env?.dados;
  } catch {
    return [];
  }
  if (!Array.isArray(dados)) return [];

  const out: PagamentoDas[] = [];
  for (const item of dados) {
    if (!item || typeof item !== 'object') continue;
    const doc = item as Record<string, unknown>;

    const numeroDocumento = typeof doc.numeroDocumento === 'string' ? doc.numeroDocumento : null;
    if (!numeroDocumento) continue;

    const competencia = extractCompetencia(doc.periodoApuracao);
    if (!competencia) continue;

    out.push({
      competencia,
      numeroDocumento,
      valorTotal: num(doc.valorTotal),
      valorPrincipal: num(doc.valorPrincipal),
      valorMulta: num(doc.valorMulta),
      valorJuros: num(doc.valorJuros),
      dataVencimento: extractDate(doc.dataVencimento),
      dataPagamento: extractDate(doc.dataArrecadacao),
    });
  }
  return out;
}
