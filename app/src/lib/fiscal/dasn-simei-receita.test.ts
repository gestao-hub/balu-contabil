import { describe, it, expect } from 'vitest';
import { somarReceitaAnualMei } from './dasn-simei-receita';

describe('somarReceitaAnualMei', () => {
  it('classifica NFSe→serviço e NFe/NFCe→comércio e soma cada lado', () => {
    const r = somarReceitaAnualMei([
      { tipo: 'NFSe', valor: 1000 },
      { tipo: 'NFe', valor: 500 },
      { tipo: 'NFCe', valor: 200 },
      { tipo: 'NFSe', valor: 300 },
    ]);
    expect(r).toEqual({ comercio: 700, servico: 1300 });
  });

  it('lista vazia → zero dos dois lados', () => {
    expect(somarReceitaAnualMei([])).toEqual({ comercio: 0, servico: 0 });
  });

  it('ignora valores não-numéricos (defensivo)', () => {
    const r = somarReceitaAnualMei([
      { tipo: 'NFe', valor: 100 },
      { tipo: 'NFe', valor: Number.NaN },
      { tipo: 'NFSe', valor: undefined as unknown as number },
    ]);
    expect(r).toEqual({ comercio: 100, servico: 0 });
  });

  it('tipo desconhecido lança (não some receita silenciosamente no lado errado)', () => {
    expect(() => somarReceitaAnualMei([{ tipo: 'XPTO', valor: 10 }])).toThrow(/tipo_documento/);
  });
});
