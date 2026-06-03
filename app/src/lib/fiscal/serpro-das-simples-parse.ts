// Parser puro da resposta do PGDAS-D / GERARDAS12 (gerar DAS de um período).
// Distingue "nada devido" (período sem débito em aberto) de "com valor".
// A estrutura "com valor" é modelada no parseDasMei (mesma família) e deve ser
// confirmada contra o primeiro DAS real em aberto (smoke). Puro/testável.

import { isNadaDevido } from './serpro-das-comum';

export type DasSimplesResult =
  | { semValor: true }
  | {
      semValor: false;
      numeroDas: string | null;
      dataVencimento: string | null; // ISO 'YYYY-MM-DD'
      valores: { principal: number; multa: number; juros: number; total: number };
      codigoDeBarras: string[];
      pdfBase64: string | null;
    };

function isoFromAaaammdd(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseDasSimples(resp: unknown): DasSimplesResult {
  const env = (resp ?? {}) as { dados?: unknown; mensagens?: unknown };

  // "Nada devido": dados vazio OU mensagem MSG_E0139.
  if (isNadaDevido(resp)) return { semValor: true };

  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      return { semValor: true };
    }
  }
  const first = Array.isArray(dados) ? dados[0] : dados;
  const obj = (first ?? {}) as { detalhamento?: unknown; pdf?: unknown };
  const det = Array.isArray(obj.detalhamento) ? obj.detalhamento[0] : undefined;
  if (!det) return { semValor: true };

  const d = det as {
    numeroDocumento?: unknown;
    dataVencimento?: unknown;
    valores?: { principal?: unknown; multa?: unknown; juros?: unknown; total?: unknown };
    codigoDeBarras?: unknown;
  };
  const v = d.valores ?? {};
  return {
    semValor: false,
    numeroDas: typeof d.numeroDocumento === 'string' ? d.numeroDocumento : null,
    dataVencimento: isoFromAaaammdd(d.dataVencimento),
    valores: { principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total: num(v.total) },
    codigoDeBarras: Array.isArray(d.codigoDeBarras) ? d.codigoDeBarras.map(String) : [],
    pdfBase64: typeof obj.pdf === 'string' ? obj.pdf : null,
  };
}
