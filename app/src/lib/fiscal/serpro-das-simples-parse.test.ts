import { describe, it, expect } from 'vitest';
import { parseDasSimples } from './serpro-das-simples-parse';

// "Nada devido" — resposta REAL capturada (GERARDAS12 em período pago).
const NADA_DEVIDO = {
  status: 200,
  dados: '',
  mensagens: [{ codigo: '[Aviso-PGDASD-MSG_E0139]', texto: 'Não foi gerado DAS por não haver valor devido para o período informado.' }],
};

// "Com valor" — fixture modelada no parseDasMei (mesma família; confirmar no smoke).
const COM_VALOR = {
  status: 200,
  dados: JSON.stringify([
    {
      detalhamento: [
        {
          numeroDocumento: '07202599999999999',
          dataVencimento: '20250220',
          valores: { principal: 1000.5, multa: 0, juros: 0, total: 1000.5 },
          codigoDeBarras: ['85800000010', '00501234567'],
        },
      ],
      pdf: 'JVBERi0xLjQK',
    },
  ]),
};

describe('parseDasSimples', () => {
  it('período pago → { semValor: true } (MSG_E0139)', () => {
    expect(parseDasSimples(NADA_DEVIDO)).toEqual({ semValor: true });
  });

  it('com valor → extrai valores/vencimento/barras/pdf', () => {
    const r = parseDasSimples(COM_VALOR);
    expect(r.semValor).toBe(false);
    if (r.semValor) return; // narrow
    expect(r.numeroDas).toBe('07202599999999999');
    expect(r.dataVencimento).toBe('2025-02-20');
    expect(r.valores.total).toBe(1000.5);
    expect(r.valores.principal).toBe(1000.5);
    expect(r.codigoDeBarras).toEqual(['85800000010', '00501234567']);
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
    // dados válido mas sem detalhamento.
    expect(() => parseDasSimples({ dados: JSON.stringify([{ foo: 1 }]) })).toThrow(/detalhamento/i);
  });

  it('total com fallback p/ totalConsolidado quando total ausente', () => {
    const resp = {
      dados: JSON.stringify([
        { detalhamento: [{ numeroDocumento: 'X', dataVencimento: '20260220', valores: { totalConsolidado: 250.75 }, codigoDeBarras: [] }] },
      ]),
    };
    const r = parseDasSimples(resp);
    expect(r.semValor).toBe(false);
    if (r.semValor) return;
    expect(r.valores.total).toBe(250.75);
  });
});
