import { describe, it, expect } from 'vitest';
import {
  normalizarNumeroDas, indexarPagamentos, casarPagamento, planejarBaixas,
} from './pagamentos-das-match';
import type { PagamentoDas } from './serpro-pagamentos-parse';

function pag(over: Partial<PagamentoDas> = {}): PagamentoDas {
  return {
    competencia: '202604',
    numeroDocumento: '7202610733758790',
    valorTotal: 123.45,
    valorPrincipal: 120,
    valorMulta: 1.45,
    valorJuros: 2,
    dataVencimento: '2026-05-20',
    dataPagamento: '2026-05-18',
    ...over,
  };
}

describe('normalizarNumeroDas', () => {
  it('tira o zero à esquerda que separa as duas APIs da SERPRO', () => {
    // O CONSDECLARACAO13 devolve com o zero, o PAGAMENTOS71 sem — mesmo documento.
    expect(normalizarNumeroDas('07202610733758790')).toBe('7202610733758790');
    expect(normalizarNumeroDas('7202610733758790')).toBe('7202610733758790');
  });
  it('tira máscara e espaço', () => {
    expect(normalizarNumeroDas(' 07.2026-1073 3758790 ')).toBe('7202610733758790');
  });
  it('null/undefined/vazio viram string vazia (não casam com nada)', () => {
    expect(normalizarNumeroDas(null)).toBe('');
    expect(normalizarNumeroDas(undefined)).toBe('');
    expect(normalizarNumeroDas('000')).toBe('');
  });
});

describe('casarPagamento', () => {
  const ix = indexarPagamentos([pag()]);

  it('casa apesar do zero à esquerda', () => {
    expect(casarPagamento('07202610733758790', ix)?.numeroDocumento).toBe('7202610733758790');
  });
  it('não casa número diferente', () => {
    expect(casarPagamento('9999999999999999', ix)).toBeUndefined();
  });
  it('não casa quando a competência não tem DAS gerado (numeroDas nulo)', () => {
    // Sem esta guarda, `normalizarNumeroDas(null)` = '' e um índice que tivesse
    // chave vazia casaria competência nenhuma com um pagamento qualquer.
    expect(casarPagamento(null, ix)).toBeUndefined();
  });
});

describe('planejarBaixas', () => {
  it('planeja baixa só para a competência cujo DAS aparece pago', () => {
    const plano = planejarBaixas(
      [
        { competencia: '202604', numeroDas: '07202610733758790' },
        { competencia: '202605', numeroDas: '07202611111111111' },
        { competencia: '202606', numeroDas: null },
      ],
      [pag()],
    );
    expect(plano.baixas).toHaveLength(1);
    expect(plano.baixas[0]).toMatchObject({ competencia: '202604', dataPagamento: '2026-05-18' });
    expect(plano.semDataDePagamento).toBe(0);
  });

  it('DAS pago SEM data de arrecadação não vira baixa', () => {
    // Marcar 'paga' com data nula quebraria a idempotência de
    // registrar_pagamento_guia, que usa `data_pagamento IS NOT NULL` como
    // sinal de "já quitada" — a guia voltaria a ser processada toda rodada.
    const plano = planejarBaixas(
      [{ competencia: '202604', numeroDas: '07202610733758790' }],
      [pag({ dataPagamento: null })],
    );
    expect(plano.baixas).toHaveLength(0);
    expect(plano.semDataDePagamento).toBe(1);
  });

  it('dois DAS na mesma competência (parcelamento) não colidem — casa por documento', () => {
    // O upsert é por (empresa, competência); o casamento NÃO pode ser por
    // competência, senão dois documentos do mesmo mês disputariam a mesma linha.
    const plano = planejarBaixas(
      [
        { competencia: '202604', numeroDas: '111' },
        { competencia: '202605', numeroDas: '222' },
      ],
      [pag({ numeroDocumento: '222', dataPagamento: '2026-06-10' })],
    );
    expect(plano.baixas).toEqual([
      expect.objectContaining({ competencia: '202605', dataPagamento: '2026-06-10' }),
    ]);
  });

  it('sem pagamento nenhum, plano vazio', () => {
    const plano = planejarBaixas([{ competencia: '202604', numeroDas: '111' }], []);
    expect(plano.baixas).toEqual([]);
    expect(plano.semDataDePagamento).toBe(0);
  });
});
