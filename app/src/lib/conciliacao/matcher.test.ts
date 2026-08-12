import { describe, it, expect } from 'vitest';
import { casar, reaisParaCentavos, type GuiaCandidata, type TransacaoCandidata } from './matcher';

const guia = (id: string, valorTotal: number | string, dataVencimento: string): GuiaCandidata =>
  ({ id, valorTotal, dataVencimento });
const tx = (id: string, valorCentavos: number, data: string, tipo: 'credito' | 'debito' = 'credito'): TransacaoCandidata =>
  ({ id, valorCentavos, data, tipo });

describe('reaisParaCentavos', () => {
  it('converte o numeric do Postgres (string) sem perder centavo', () => {
    // Valor real lido do banco em 12/08/2026.
    expect(reaisParaCentavos('12666.19')).toBe(1266619);
  });

  it('arredonda em vez de truncar — 126.66*100 dá 12665.999... em float', () => {
    expect(reaisParaCentavos(126.66)).toBe(12666);
    expect(reaisParaCentavos('126.66')).toBe(12666);
  });

  it('nulo, vazio e lixo viram null (não zero)', () => {
    // Virar 0 seria pior que null: casaria com transação de valor zero.
    expect(reaisParaCentavos(null)).toBeNull();
    expect(reaisParaCentavos('')).toBeNull();
    expect(reaisParaCentavos('abc')).toBeNull();
  });
});

describe('casar — baixa automática', () => {
  it('valor exato e data na janela: dá baixa', () => {
    const r = casar([tx('t1', 1266619, '2026-02-20')], [guia('g1', '12666.19', '2026-02-20')]);
    expect(r).toEqual([{ transacaoId: 't1', guiaId: 'g1', decisao: 'baixa', motivo: expect.any(String) }]);
  });

  it('aceita pagamento adiantado (até 30 dias antes)', () => {
    const r = casar([tx('t1', 50000, '2026-01-25')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r[0]?.decisao).toBe('baixa');
  });

  it('aceita pagamento atrasado (até 60 dias depois)', () => {
    const r = casar([tx('t1', 50000, '2026-04-15')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r[0]?.decisao).toBe('baixa');
  });
});

describe('casar — o que NÃO pode dar baixa', () => {
  it('um centavo de diferença não casa', () => {
    // Guia paga com juros/multa não é a mesma guia: o valor tem de bater.
    const r = casar([tx('t1', 50001, '2026-02-20')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });

  it('débito nunca paga guia', () => {
    const r = casar([tx('t1', 50000, '2026-02-20', 'debito')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });

  it('fora da janela não casa (61 dias depois)', () => {
    const r = casar([tx('t1', 50000, '2026-04-22')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });

  it('fora da janela não casa (31 dias antes)', () => {
    const r = casar([tx('t1', 50000, '2026-01-20')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });

  it('duas guias do mesmo valor: vira sugestão para as duas, sem baixa', () => {
    // O erro clássico seria "pegar a mais antiga": 50% de chance de quitar a
    // competência errada, e o cliente só descobre no mês seguinte.
    const r = casar(
      [tx('t1', 50000, '2026-02-20')],
      [guia('g1', '500.00', '2026-02-20'), guia('g2', '500.00', '2026-03-20')],
    );
    expect(r).toHaveLength(2);
    expect(r.every((c) => c.decisao === 'sugestao')).toBe(true);
  });

  it('duas entradas iguais para a mesma guia: nenhuma dá baixa sozinha', () => {
    // Uma pagou; a outra é duplicidade ou estorno reaplicado. Adivinhar qual
    // é o mesmo erro com os papéis trocados.
    const r = casar(
      [tx('t1', 50000, '2026-02-19'), tx('t2', 50000, '2026-02-20')],
      [guia('g1', '500.00', '2026-02-20')],
    );
    expect(r).toHaveLength(2);
    expect(r.every((c) => c.decisao === 'sugestao')).toBe(true);
  });

  it('guia sem valor ou sem vencimento é ignorada, não casada por acaso', () => {
    const r = casar(
      [tx('t1', 50000, '2026-02-20')],
      [guia('g1', null as unknown as number, '2026-02-20'), { id: 'g2', valorTotal: '500.00', dataVencimento: null }],
    );
    expect(r).toEqual([]);
  });

  it('guia de valor zero não casa com transação de zero', () => {
    const r = casar([tx('t1', 0, '2026-02-20')], [guia('g1', '0.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });

  it('data inválida no extrato não casa', () => {
    const r = casar([tx('t1', 50000, 'não-é-data')], [guia('g1', '500.00', '2026-02-20')]);
    expect(r).toEqual([]);
  });
});

describe('casar — cenário realista', () => {
  it('separa a baixa limpa da ambígua no mesmo lote', () => {
    const transacoes = [
      tx('t1', 1266619, '2026-02-21'),  // casa só com g1
      tx('t2', 50000, '2026-03-20'),    // ambígua: g2 e g3 têm o mesmo valor
      tx('t3', 999, '2026-03-01'),      // não casa com nada
      tx('t4', 30000, '2026-03-20', 'debito'), // débito, ignorado
    ];
    const guias = [
      guia('g1', '12666.19', '2026-02-20'),
      guia('g2', '500.00', '2026-03-20'),
      // 2026-04-10, e não 04-20: a 20 dias da transação, dentro da janela.
      // Com 04-20 seriam 31 dias, um dia FORA — a ambiguidade sumiria e o
      // cenário deixaria de testar o que se propõe.
      guia('g3', '500.00', '2026-04-10'),
      guia('g4', '300.00', '2026-03-20'),
    ];

    const r = casar(transacoes, guias);

    expect(r.filter((c) => c.decisao === 'baixa')).toEqual([
      { transacaoId: 't1', guiaId: 'g1', decisao: 'baixa', motivo: expect.any(String) },
    ]);
    expect(r.filter((c) => c.decisao === 'sugestao').map((c) => c.guiaId).sort()).toEqual(['g2', 'g3']);
  });
});
