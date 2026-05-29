import { describe, it, expect } from 'vitest';
import { parseDasMei } from './das-mei-parse';

// Envelope real do Serpro: dados é STRING JSON.
const detalhe = {
  periodoApuracao: '201901',
  numeroDocumento: '07.0.00000-00',
  dataVencimento: '20190220',
  valores: { principal: 55.9, multa: 11.18, juros: 10.71, total: 77.79 },
  codigoDeBarras: ['8166', '0000', '0779', '1234'],
};
const envelopeComPdf = {
  status: 200,
  mensagens: [{ codigo: 'Sucesso', texto: 'Requisição efetuada com sucesso' }],
  dados: JSON.stringify([{ cnpjCompleto: '00000000000100', detalhamento: [detalhe], pdf: 'JVBERi0xLjQK' }]),
};

describe('parseDasMei', () => {
  it('extrai número, vencimento ISO, valores, código de barras e pdf', () => {
    const r = parseDasMei(envelopeComPdf);
    expect(r.numeroDocumento).toBe('07.0.00000-00');
    expect(r.dataVencimento).toBe('2019-02-20');
    expect(r.valores.total).toBe(77.79);
    expect(r.valores.principal).toBe(55.9);
    expect(r.codigoDeBarras).toEqual(['8166', '0000', '0779', '1234']);
    expect(r.pdfBase64).toBe('JVBERi0xLjQK');
  });

  it('pdf ausente (variante código de barras) → pdfBase64 null', () => {
    const env = { ...envelopeComPdf, dados: JSON.stringify([{ detalhamento: [detalhe] }]) };
    expect(parseDasMei(env).pdfBase64).toBeNull();
  });

  it('aceita dados já como objeto (não-string)', () => {
    const env = { status: 200, dados: [{ detalhamento: [detalhe], pdf: 'x' }] };
    expect(parseDasMei(env).valores.total).toBe(77.79);
  });

  it('lança quando não há detalhamento', () => {
    const env = { status: 200, dados: JSON.stringify([{ detalhamento: [] }]) };
    expect(() => parseDasMei(env)).toThrow(/não retornou DAS/);
  });
});
