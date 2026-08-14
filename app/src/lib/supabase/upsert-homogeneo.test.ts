import { describe, it, expect } from 'vitest';
import { agruparPorColunas } from './upsert-homogeneo';

// O que estes testes protegem: `postgrest-js.upsert(array)` manda a UNIÃO das
// chaves do array e preenche com NULL o que falta em cada linha. Num
// ON CONFLICT DO UPDATE isso APAGA valor já gravado. Um upsert por assinatura
// de colunas é o que impede isso.

describe('agruparPorColunas', () => {
  it('lote já homogêneo sai inteiro, num grupo só', () => {
    const r = agruparPorColunas([
      { id: 1, nome: 'a' },
      { id: 2, nome: 'b' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].colunas).toEqual(['id', 'nome']);
    expect(r[0].linhas).toHaveLength(2);
  });

  it('O CASO REAL: linha rica e linha magra NÃO viajam juntas', () => {
    // Sem a separação, a segunda linha iria com linha_digitavel=NULL e
    // apagaria o código de barras já gravado da competência 202603.
    const r = agruparPorColunas([
      { competencia: '202605', status: 'gerada', linha_digitavel: '85810000...', valor_total: 1234.56 },
      { competencia: '202603', status: 'gerada' },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].colunas).toContain('linha_digitavel');
    expect(r[1].colunas).not.toContain('linha_digitavel');
    expect(r[1].linhas).toEqual([{ competencia: '202603', status: 'gerada' }]);
  });

  it('a ordem das chaves no objeto não cria grupo novo', () => {
    const r = agruparPorColunas([
      { a: 1, b: 2 },
      { b: 3, a: 4 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].linhas).toHaveLength(2);
  });

  it('undefined é descartado — mandá-lo reintroduziria o NULL por outra porta', () => {
    const r = agruparPorColunas([
      { a: 1, b: undefined },
      { a: 2 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].colunas).toEqual(['a']);
    expect(r[0].linhas).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('null NÃO é descartado — gravar NULL de propósito é legítimo', () => {
    const r = agruparPorColunas([{ a: 1, deleted_at: null }]);
    expect(r[0].colunas).toEqual(['a', 'deleted_at']);
    expect(r[0].linhas[0]).toHaveProperty('deleted_at', null);
  });

  it('três assinaturas distintas viram três lotes, na ordem de aparição', () => {
    const r = agruparPorColunas([
      { a: 1 },
      { a: 2, b: 1 },
      { a: 3 },
      { a: 4, b: 2, c: 3 },
    ]);
    expect(r.map((l) => l.colunas)).toEqual([['a'], ['a', 'b'], ['a', 'b', 'c']]);
    expect(r[0].linhas).toHaveLength(2);
  });

  it('lista vazia não gera lote nenhum', () => {
    expect(agruparPorColunas([])).toEqual([]);
  });

  it('toda linha de entrada aparece em exatamente um lote', () => {
    const entrada = [
      { a: 1 }, { a: 2, b: 1 }, { a: 3 }, { b: 9 }, { a: 4, b: 2 },
    ];
    const r = agruparPorColunas(entrada);
    expect(r.reduce((n, l) => n + l.linhas.length, 0)).toBe(entrada.length);
  });
});
