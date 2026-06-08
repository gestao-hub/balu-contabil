import { describe, it, expect } from 'vitest';
import { parseDasSimples } from './serpro-das-simples-parse';

// "Nada devido" — resposta REAL capturada (GERARDAS12 em período pago).
const NADA_DEVIDO = {
  status: 200,
  dados: '',
  mensagens: [{ codigo: '[Aviso-PGDASD-MSG_E0139]', texto: 'Não foi gerado DAS por não haver valor devido para o período informado.' }],
};

// "Com valor" — resposta REAL do GERARDAS12 (AL PISCINAS 202604, 2026-06-08).
// Estrutura: dados[0].detalhamentoDas (OBJETO), pdf em dados[0].pdf, SEM codigoDeBarras.
const COM_VALOR = {
  status: 200,
  mensagens: [{ codigo: '[Sucesso-PGDASD]', texto: 'Requisição efetuada com sucesso.' }],
  dados: JSON.stringify([
    {
      pdf: 'JVBERi0xLjQK',
      cnpjCompleto: '10358425000120',
      detalhamentoDas: {
        periodoApuracao: '202604',
        numeroDocumento: '07202615945594406',
        dataVencimento: '20260520',
        dataLimiteAcolhimento: '20260608',
        valores: { principal: 10328.59, multa: 647.6, juros: 103.29, total: 11079.48 },
        observacao1: '',
        observacao2: 'IC',
        observacao3: '',
        composicao: [
          { periodoApuracao: '202604', codigo: '1001', denominacao: '04/2026', valores: { principal: 831.76, multa: 52.15, juros: 8.32, total: 892.23 } },
        ],
      },
    },
  ]),
};

describe('parseDasSimples', () => {
  it('período pago → { semValor: true } (MSG_E0139)', () => {
    expect(parseDasSimples(NADA_DEVIDO)).toEqual({ semValor: true });
  });

  it('com valor → extrai numeroDocumento/vencimento/valores/pdf de detalhamentoDas', () => {
    const r = parseDasSimples(COM_VALOR);
    expect(r.semValor).toBe(false);
    if (r.semValor) return; // narrow
    expect(r.numeroDas).toBe('07202615945594406');
    expect(r.dataVencimento).toBe('2026-05-20');
    expect(r.valores.total).toBe(11079.48);
    expect(r.valores.principal).toBe(10328.59);
    expect(r.valores.multa).toBe(647.6);
    expect(r.valores.juros).toBe(103.29);
    // GERARDAS12 não devolve linha digitável/código de barras — só o PDF.
    expect(r.codigoDeBarras).toEqual([]);
    expect(r.pdfBase64).toBe('JVBERi0xLjQK');
  });

  it('nada devido legítimo (dados vazio/ausente) → { semValor: true }', () => {
    expect(parseDasSimples({})).toEqual({ semValor: true });
    expect(parseDasSimples({ dados: '' })).toEqual({ semValor: true });
    expect(parseDasSimples(null)).toEqual({ semValor: true });
  });

  it('resposta com valor mas formato inesperado → LANÇA (não mascara como semValor)', () => {
    // dados não-JSON numa resposta que não é "nada devido".
    expect(() => parseDasSimples({ dados: 'não-json' })).toThrow(/formato inesperado/i);
    // dados válido mas sem detalhamentoDas.
    expect(() => parseDasSimples({ dados: JSON.stringify([{ foo: 1 }]) })).toThrow(/detalhamento/i);
  });

  it('total com fallback p/ totalConsolidado quando total ausente', () => {
    const resp = {
      dados: JSON.stringify([
        { detalhamentoDas: { numeroDocumento: 'X', dataVencimento: '20260220', valores: { totalConsolidado: 250.75 } } },
      ]),
    };
    const r = parseDasSimples(resp);
    expect(r.semValor).toBe(false);
    if (r.semValor) return;
    expect(r.valores.total).toBe(250.75);
  });
});
