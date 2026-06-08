// Parser puro da resposta do PGDAS-D / GERARDAS12 (gerar DAS de um período).
// Distingue "nada devido" (período sem débito em aberto) de "com valor".
//
// Nomes de campo confirmados contra a doc oficial (Integra Contador / PGDAS-D):
// numeroDocumento, dataVencimento, valores{principal,multa,juros,total,totalConsolidado},
// codigoDeBarras, pdf. O ANINHAMENTO exato (dados[].detalhamento[]) ainda espelha o
// parseDasMei e só foi validado no caso "nada devido" (fixture real). Por isso, em vez
// de mascarar uma resposta inesperada como "nada devido" (= guia R$0 silenciosa), aqui
// a gente FALHA ALTO: loga a estrutura crua e lança — o 1º DAS real que divergir vira
// erro visível + log (o "smoke" acontece sozinho, com segurança). Puro/testável.

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
      // Não é "nada devido" (já descartado acima) e não dá pra ler: não mascarar
      // como semValor — falhar alto e logar a forma crua p/ confirmar a estrutura.
      console.warn('[parseDasSimples] `dados` não-JSON numa resposta com valor:', String(env.dados).slice(0, 300));
      throw new Error('Resposta do DAS (Simples) em formato inesperado (dados não-JSON).');
    }
  }
  const first = Array.isArray(dados) ? dados[0] : dados;
  const obj = (first ?? {}) as { detalhamentoDas?: unknown; pdf?: unknown };
  // Estrutura REAL do GERARDAS12 (confirmada AL PISCINAS 202604, 2026-06-08):
  // dados[0].detalhamentoDas (OBJETO), pdf em dados[0].pdf, sem codigoDeBarras (só o PDF).
  const det = obj.detalhamentoDas;
  if (!det || typeof det !== 'object') {
    console.warn('[parseDasSimples] resposta com valor sem `detalhamentoDas` — estrutura inesperada:', JSON.stringify(dados).slice(0, 500));
    throw new Error('Resposta do DAS (Simples) sem detalhamentoDas — estrutura inesperada (ver log).');
  }

  const d = det as {
    numeroDocumento?: unknown;
    dataVencimento?: unknown;
    valores?: { principal?: unknown; multa?: unknown; juros?: unknown; total?: unknown; totalConsolidado?: unknown };
    codigoDeBarras?: unknown;
  };
  const v = d.valores ?? {};
  // total com fallback p/ totalConsolidado (campo extra documentado pela SERPRO).
  const total = num(v.total) || num(v.totalConsolidado);
  return {
    semValor: false,
    numeroDas: typeof d.numeroDocumento === 'string' ? d.numeroDocumento : null,
    dataVencimento: isoFromAaaammdd(d.dataVencimento),
    valores: { principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total },
    codigoDeBarras: Array.isArray(d.codigoDeBarras) ? d.codigoDeBarras.map(String) : [],
    pdfBase64: typeof obj.pdf === 'string' ? obj.pdf : null,
  };
}
