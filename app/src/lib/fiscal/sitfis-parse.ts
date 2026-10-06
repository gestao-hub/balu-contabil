// SITFIS (Relatório de Situação Fiscal) — parser puro. Sem rede, sem banco.
//
// ⚠️ MODELADO PELA DOC (06/10/2026), sem envelope real ainda:
//   SOLICITARPROTOCOLO91 (/Apoiar)  → dados { protocoloRelatorio, tempoEspera (ms) }
//                                     ou 304 sem corpo, protocolo no ETag
//   RELATORIOSITFIS92   (/Emitir)   → 200 dados { pdf (base64) }
//                                     ou 202 dados { tempoEspera (s) } = ainda gerando
//
// RESULTADO DO RELATÓRIO. A Receita entrega PDF, não dados. Ler pendências
// exigiria uma biblioteca de PDF que o projeto não tem (dependências de
// produção enxutas são decisão de segurança). O que se faz aqui é um INDÍCIO:
// os textos do PDF são extraídos dos fluxos (descomprimidos com zlib) e
// procuram-se as duas frases que o relatório usa. Quando nenhuma aparece com
// segurança, o resultado é 'indeterminado' — e a tela diz isso, sem chutar.
import { inflateSync } from 'node:zlib';

type Obj = Record<string, unknown>;

function lerDados(envelope: unknown): Obj {
  const env = (envelope ?? {}) as { dados?: unknown };
  let d: unknown = env.dados;
  if (typeof d === 'string') {
    if (!d.trim()) return {};
    try { d = JSON.parse(d); } catch { throw new Error('Resposta do SITFIS em formato inesperado.'); }
  }
  return (d && typeof d === 'object' ? d : {}) as Obj;
}

/** Protocolo do pedido — do corpo, ou do ETag quando veio 304. */
export function parseProtocolo(corpo: unknown | null, etag: string | null): { protocolo: string | null; esperaMs: number } {
  const d = corpo ? lerDados(corpo) : {};
  const doCorpo = typeof d.protocoloRelatorio === 'string' && d.protocoloRelatorio.trim() ? d.protocoloRelatorio.trim() : null;
  // ETag pode vir entre aspas e com prefixo W/.
  const doEtag = etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '').trim() || null : null;
  const espera = Number(d.tempoEspera);
  return { protocolo: doCorpo ?? doEtag, esperaMs: Number.isFinite(espera) && espera > 0 ? espera : 0 };
}

/** Emissão: o PDF pronto, ou "ainda gerando" com quanto esperar (em ms). */
export function parseEmissao(envelope: unknown):
  | { pronto: true; pdf: Buffer }
  | { pronto: false; esperaMs: number } {
  const d = lerDados(envelope);
  if (typeof d.pdf === 'string' && d.pdf.trim()) {
    return { pronto: true, pdf: Buffer.from(d.pdf, 'base64') };
  }
  const espera = Number(d.tempoEspera);
  // tempoEspera da emissão vem em SEGUNDOS (doc do RELATORIOSITFIS92).
  return { pronto: false, esperaMs: Number.isFinite(espera) && espera > 0 ? espera * 1000 : 5000 };
}

// ─── INDÍCIO DE PENDÊNCIAS ───────────────────────────────────────────────────

export type ResultadoSitfis = 'sem_pendencias' | 'com_pendencias' | 'indeterminado';

/** Literais de texto `( … )` dos operadores Tj/TJ, com os escapes do PDF. */
function literaisDoConteudo(conteudo: string): string[] {
  const saida: string[] = [];
  const re = /\(((?:\\.|[^\\()])*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conteudo))) {
    saida.push(m[1]
      .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ')
      .replace(/\\(.)/g, '$1'));
  }
  return saida;
}

/** Texto aproximado do PDF: fluxos descomprimidos (Flate) e crus. */
export function textoDoPdf(pdf: Buffer): string {
  const bruto = pdf.toString('latin1');
  const partes: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    const dados = Buffer.from(m[1], 'latin1');
    let conteudo: string;
    try { conteudo = inflateSync(dados).toString('latin1'); }
    catch { conteudo = m[1]; } // fluxo não comprimido
    partes.push(literaisDoConteudo(conteudo).join(''));
  }
  return partes.join('\n');
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

/**
 * O relatório diz "Pendência - Débito", "Pendência - Omissão de …" quando há
 * pendência, e "Não foram detectadas pendências" quando não há. A primeira
 * vence: um relatório pode dizer "não foram detectadas" para um órgão (PGFN) e
 * listar pendência no outro (Receita).
 */
export function analisarRelatorio(pdf: Buffer): ResultadoSitfis {
  const t = normalizar(textoDoPdf(pdf));
  if (!t.trim()) return 'indeterminado';
  if (/pendencia\s*-\s*\w/.test(t)) return 'com_pendencias';
  if (t.includes('nao foram detectadas pendencias')) return 'sem_pendencias';
  return 'indeterminado';
}

/** Começa com %PDF — a única checagem que vale antes de guardar o arquivo. */
export function pareceUmPdf(b: Buffer): boolean {
  return b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF';
}
