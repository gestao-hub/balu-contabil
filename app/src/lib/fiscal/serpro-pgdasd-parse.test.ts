import { describe, it, expect } from 'vitest';
import { parseDeclaracaoPgdasd } from './serpro-pgdasd-parse';

const envelope = {
  status: '200',
  mensagens: [{ codigo: 'Sucesso-PGDASD', texto: 'Requisição efetuada com sucesso.' }],
  dados: JSON.stringify({
    idDeclaracao: '00000000202104001',
    dataHoraTransmissao: '20220803044803',
    valoresDevidos: [
      { codigoTributo: 1001, valor: 44.0 },
      { codigoTributo: 1006, valor: 332.0 },
      { codigoTributo: 1010, valor: 120.6 },
    ],
    declaracao: 'JVBERi0xLjUK...',
  }),
};

describe('parseDeclaracaoPgdasd', () => {
  it('extrai tributos, total e número da declaração', () => {
    const r = parseDeclaracaoPgdasd(envelope);
    expect(r.numeroDeclaracao).toBe('00000000202104001');
    expect(r.valorTotalDevido).toBeCloseTo(496.6, 2);
    expect(r.tributos.find((t) => t.codigo === 1006)!.nome).toBe('INSS/CPP');
    expect(r.tributos).toHaveLength(3);
    expect(r.transmitida).toBe(true);
  });
  it('dry-run sem idDeclaracao → transmitida=false, ainda traz valores', () => {
    const dry = { ...envelope, dados: JSON.stringify({ valoresDevidos: [{ codigoTributo: 1010, valor: 50 }] }) };
    const r = parseDeclaracaoPgdasd(dry);
    expect(r.transmitida).toBe(false);
    expect(r.numeroDeclaracao).toBeNull();
    expect(r.valorTotalDevido).toBeCloseTo(50, 2);
  });
  it('formato inesperado → lança', () => {
    expect(() => parseDeclaracaoPgdasd({ foo: 'bar' })).toThrow();
  });
});
