// Parser puro da resposta do PGDAS-D / CONSDECLARACAO13 (listagem de declarações/DAS do ano).
// O serviço é um ÍNDICE de situação: por período traz a declaração transmitida e o DAS gerado
// (+ dasPago). NÃO traz valor/vencimento. Puro/testável — sem deps de rede/Supabase.

export type SituacaoPeriodo = {
  competencia: string;            // 'YYYYMM' (= String(periodoApuracao))
  numeroDeclaracao: string | null;
  dataTransmissao: string | null; // ISO; null se ausente
  numeroDas: string | null;
  dasPago: boolean | null;        // null quando não há DAS gerado
  status: 'paga' | 'gerada' | 'pendente';
};

/** 'YYYYMMDDHHmmss' → ISO com offset de Brasília. null se inválido. */
function parseDataHora(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{14}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}-03:00`;
}

function statusDe(numeroDas: string | null, dasPago: boolean | null): SituacaoPeriodo['status'] {
  if (dasPago === true) return 'paga';
  if (numeroDas) return 'gerada';
  return 'pendente';
}

type Operacao = {
  indiceDeclaracao?: { numeroDeclaracao?: unknown; dataHoraTransmissao?: unknown } | null;
  indiceDas?: { numeroDas?: unknown; dasPago?: unknown } | null;
};
type Periodo = { periodoApuracao?: unknown; operacoes?: Operacao[] };

export function parseConsultaDeclaracoes(resp: unknown): SituacaoPeriodo[] {
  // Desempacota o envelope SERPRO: dados é uma string JSON.
  const env = resp as { dados?: unknown } | null;
  let dados: unknown;
  try {
    dados = typeof env?.dados === 'string' ? JSON.parse(env.dados) : env?.dados;
  } catch {
    return [];
  }
  const periodos = (dados as { periodos?: unknown })?.periodos;
  if (!Array.isArray(periodos)) return [];

  const out: SituacaoPeriodo[] = [];
  for (const p of periodos as Periodo[]) {
    if (p?.periodoApuracao == null) continue;
    const competencia = String(p.periodoApuracao);
    let numeroDeclaracao: string | null = null;
    let dataTransmissao: string | null = null;
    let numeroDas: string | null = null;
    let dasPago: boolean | null = null;

    for (const op of Array.isArray(p.operacoes) ? p.operacoes : []) {
      if (op?.indiceDeclaracao) {
        const nd = op.indiceDeclaracao.numeroDeclaracao;
        if (typeof nd === 'string') numeroDeclaracao = nd;
        dataTransmissao = parseDataHora(op.indiceDeclaracao.dataHoraTransmissao) ?? dataTransmissao;
      }
      if (op?.indiceDas) {
        const nDas = op.indiceDas.numeroDas;
        if (typeof nDas === 'string') numeroDas = nDas;
        if (typeof op.indiceDas.dasPago === 'boolean') dasPago = op.indiceDas.dasPago;
      }
    }

    out.push({
      competencia,
      numeroDeclaracao,
      dataTransmissao,
      numeroDas,
      dasPago,
      status: statusDe(numeroDas, dasPago),
    });
  }
  return out;
}
