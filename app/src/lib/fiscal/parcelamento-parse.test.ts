import { describe, it, expect } from 'vitest';
import {
  MODALIDADES, servico, modalidadesDoRegime, parsePedidos, parseParcelas, parsePdfDas, parcelamentoAtivo,
} from './parcelamento-parse';

const env = (dados: unknown) => ({ status: 200, mensagens: [], dados: JSON.stringify(dados) });

describe('catálogo', () => {
  it('códigos batem com o catálogo oficial', () => {
    const parcsn = MODALIDADES.find((m) => m.sistema === 'PARCSN')!;
    expect([servico.gerarDas(parcsn), servico.parcelas(parcsn), servico.pedidos(parcsn)])
      .toEqual(['GERARDAS161', 'PARCELASPARAGERAR162', 'PEDIDOSPARC163']);
    const relpmei = MODALIDADES.find((m) => m.sistema === 'RELPMEI')!;
    expect(servico.pedidos(relpmei)).toBe('PEDIDOSPARC233');
  });
  it('regime escolhe as modalidades; Regime Normal fica fora', () => {
    expect(modalidadesDoRegime('4').map((m) => m.sistema)).toEqual(['PARCMEI', 'PARCMEI-ESP', 'PERTMEI', 'RELPMEI']);
    expect(modalidadesDoRegime('1')).toHaveLength(4);
    expect(modalidadesDoRegime('3')).toEqual([]);
  });
});

describe('parsePedidos', () => {
  it('lê a lista com datas ISO', () => {
    expect(parsePedidos(env({ parcelamentos: [{ numero: 9102, dataDoPedido: 20180619, situacao: 'Em parcelamento', dataDaSituacao: 20230831 }] })))
      .toEqual([{ numero: '9102', dataPedido: '2018-06-19', situacao: 'Em parcelamento', dataSituacao: '2023-08-31' }]);
  });
  it('vazio e sem número', () => {
    expect(parsePedidos(env({ parcelamentos: [{ situacao: 'x' }] }))).toEqual([]);
    expect(parsePedidos({ dados: '' })).toEqual([]);
  });
});

describe('parseParcelas e parsePdfDas', () => {
  it('parcelas AAAAMM com valor', () => {
    expect(parseParcelas(env({ listaParcela: [{ parcela: 202610, valor: 150.5 }, { parcela: 'x' }] })))
      .toEqual([{ parcela: '202610', valor: 150.5 }]);
  });
  it('PDF do DAS em qualquer campo *pdf*', () => {
    expect(parsePdfDas(env({ docArrecadacaoPdfB64: 'JVBER' }))).toBe('JVBER');
    expect(parsePdfDas(env({}))).toBeNull();
  });
});

describe('parcelamentoAtivo', () => {
  it('em parcelamento sim; encerrado/rescindido não', () => {
    expect(parcelamentoAtivo('Em parcelamento')).toBe(true);
    expect(parcelamentoAtivo('Encerrado por rescisão')).toBe(false);
    expect(parcelamentoAtivo('Liquidado')).toBe(false);
    expect(parcelamentoAtivo(null)).toBe(false);
  });
});
