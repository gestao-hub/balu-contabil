// @custom — Modelo derivado de obrigações fiscais (Simples). Puro/testável — sem I/O.
// O estado de cada competência é função das tabelas declaracoes_fiscais/guias_fiscais/apuracoes_fiscais.
import { competenciaReferenciaBrt } from './guia';

export type EstadoObrigacao = 'a_declarar' | 'a_pagar' | 'vencida' | 'paga';

export type DeclaracaoInput = {
  competencia: string;            // 'YYYYMM'
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;
};
export type GuiaInput = {
  competencia: string;            // 'YYYYMM'
  numeroDas: string | null;
  valor: number | null;
  vencimento: string | null;      // 'YYYY-MM-DD'
  pagamento: string | null;       // 'YYYY-MM-DD'
  status: string | null;
  pdfUrl: string | null;
};
export type ApuracaoInput = {
  competencia: string;            // 'YYYYMM'
  estimativa: number | null;
};

export type ObrigacaoFiscal = {
  competencia: string;
  estado: EstadoObrigacao;
  declarada: boolean;
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;
  numeroDas: string | null;
  valor: number | null;
  vencimento: string | null;
  pagamento: string | null;
  pdfUrl: string | null;
  estimativaLocal: number | null;
};

/** Competências esperadas: de janeiro do ano corrente até o último mês FECHADO (mês corrente - 1). */
export function competenciasEsperadasDoAno(hoje: Date): string[] {
  const atual = competenciaReferenciaBrt(hoje); // 'YYYYMM'
  const ano = atual.slice(0, 4);
  const mesAtual = Number(atual.slice(4, 6));
  const out: string[] = [];
  for (let m = 1; m < mesAtual; m++) out.push(`${ano}${String(m).padStart(2, '0')}`);
  return out;
}

/** 'YYYY-MM-DD' de uma Date em BRT. */
function ymdBrt(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function venceuAntesDe(vencimento: string | null, hojeYmd: string): boolean {
  if (!vencimento) return false;
  const v = vencimento.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < hojeYmd;
}

export function derivarObrigacoes(input: {
  hoje: Date;
  competenciasEsperadas: string[];
  declaracoes: DeclaracaoInput[];
  guias: GuiaInput[];
  apuracoes: ApuracaoInput[];
}): ObrigacaoFiscal[] {
  const { hoje, competenciasEsperadas, declaracoes, guias, apuracoes } = input;
  const hojeYmd = ymdBrt(hoje);
  const decByComp = new Map(declaracoes.map((d) => [d.competencia, d]));
  const guiaByComp = new Map(guias.map((g) => [g.competencia, g]));
  const apByComp = new Map(apuracoes.map((a) => [a.competencia, a]));

  // União: esperadas + qualquer competência que já tem declaração/guia (defensivo).
  const comps = new Set<string>(competenciasEsperadas);
  for (const d of declaracoes) comps.add(d.competencia);
  for (const g of guias) comps.add(g.competencia);

  const out: ObrigacaoFiscal[] = [];
  for (const competencia of comps) {
    const d = decByComp.get(competencia) ?? null;
    const g = guiaByComp.get(competencia) ?? null;
    const a = apByComp.get(competencia) ?? null;
    const declarada = !!d?.numeroDeclaracao;
    const paga = (g?.status ?? '').toLowerCase() === 'paga' || !!g?.pagamento;

    let estado: EstadoObrigacao;
    if (paga) estado = 'paga';
    else if (venceuAntesDe(g?.vencimento ?? null, hojeYmd)) estado = 'vencida';
    else if (declarada) estado = 'a_pagar';
    else estado = 'a_declarar';

    out.push({
      competencia,
      estado,
      declarada,
      numeroDeclaracao: d?.numeroDeclaracao ?? null,
      dataTransmissao: d?.dataTransmissao ?? null,
      numeroDas: g?.numeroDas ?? null,
      valor: g?.valor ?? null,
      vencimento: g?.vencimento ?? null,
      pagamento: g?.pagamento ?? null,
      pdfUrl: g?.pdfUrl ?? null,
      estimativaLocal: a?.estimativa ?? null,
    });
  }
  return out;
}

const PESO_ESTADO: Record<EstadoObrigacao, number> = {
  vencida: 0,
  a_pagar: 1,
  a_declarar: 2,
  paga: 3,
};

/** Ordena a fila: vencida → a_pagar → a_declarar; dentro do grupo, competência ascendente. */
export function ordenarFila(obrigacoes: ObrigacaoFiscal[]): ObrigacaoFiscal[] {
  return [...obrigacoes].sort((a, b) => {
    const pe = PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado];
    if (pe !== 0) return pe;
    return a.competencia.localeCompare(b.competencia);
  });
}
