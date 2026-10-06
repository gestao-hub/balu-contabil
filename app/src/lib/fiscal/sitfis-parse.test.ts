import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { parseProtocolo, parseEmissao, analisarRelatorio, textoDoPdf, pareceUmPdf } from './sitfis-parse';

/** PDF mínimo com um fluxo de conteúdo (comprimido ou não). */
function pdfCom(linhas: string[], comprimir: boolean): Buffer {
  const conteudo = `BT /F1 10 Tf ${linhas.map((l) => `(${l}) Tj`).join(' T* ')} ET`;
  const dados = comprimir ? deflateSync(Buffer.from(conteudo, 'latin1')) : Buffer.from(conteudo, 'latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj << /Length 0 >>\nstream\n', 'latin1'),
    dados,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

describe('parseProtocolo', () => {
  it('lê do corpo, com tempo de espera em ms', () => {
    expect(parseProtocolo({ dados: JSON.stringify({ protocoloRelatorio: 'ABC', tempoEspera: 3000 }) }, null))
      .toEqual({ protocolo: 'ABC', esperaMs: 3000 });
  });
  it('304 sem corpo: protocolo vem do ETag (sem aspas nem W/)', () => {
    expect(parseProtocolo(null, 'W/"XYZ"')).toEqual({ protocolo: 'XYZ', esperaMs: 0 });
  });
  it('sem protocolo em lugar nenhum: null', () => {
    expect(parseProtocolo({ dados: '{}' }, null).protocolo).toBeNull();
  });
});

describe('parseEmissao', () => {
  it('PDF pronto em base64', () => {
    const r = parseEmissao({ dados: JSON.stringify({ pdf: Buffer.from('%PDF-x').toString('base64') }) });
    expect(r.pronto && r.pdf.toString()).toBe('%PDF-x');
  });
  it('202: ainda gerando, espera em SEGUNDOS vira ms', () => {
    expect(parseEmissao({ status: 202, dados: { tempoEspera: 30 } })).toEqual({ pronto: false, esperaMs: 30000 });
  });
});

describe('analisarRelatorio', () => {
  it('pendência listada (fluxo comprimido)', () => {
    const pdf = pdfCom(['Diagn\\363stico Fiscal', 'Pend\\352ncia - D\\351bito \\(SIEF\\)'], true);
    expect(analisarRelatorio(pdf)).toBe('com_pendencias');
  });
  it('sem pendências (fluxo cru)', () => {
    const pdf = pdfCom(['N\\343o foram detectadas pend\\352ncias/exigibilidades suspensas'], false);
    expect(analisarRelatorio(pdf)).toBe('sem_pendencias');
  });
  it('pendência na Receita vence "nenhuma" na PGFN', () => {
    const pdf = pdfCom(['N\\343o foram detectadas pend\\352ncias na PGFN', 'Pend\\352ncia - Omiss\\343o de DCTF'], true);
    expect(analisarRelatorio(pdf)).toBe('com_pendencias');
  });
  it('sem nenhuma das frases: indeterminado (não chuta)', () => {
    expect(analisarRelatorio(pdfCom(['Relat\\363rio qualquer'], true))).toBe('indeterminado');
    expect(analisarRelatorio(Buffer.from('%PDF-1.4 sem fluxo'))).toBe('indeterminado');
  });
  it('textoDoPdf decodifica escapes octais e parênteses', () => {
    expect(textoDoPdf(pdfCom(['A\\(b\\)'], false))).toContain('A(b)');
  });
  it('pareceUmPdf', () => {
    expect(pareceUmPdf(Buffer.from('%PDF-1.7'))).toBe(true);
    expect(pareceUmPdf(Buffer.from('<html>'))).toBe(false);
  });
});
