import { describe, it, expect } from 'vitest';
import { montarDeclaracaoPgdasd } from './pgdasd-declaracao';

const base = {
  cnpj: '10358425000120',
  competencia: '202606',
  atividadesMes: [{ idAtividade: 1, valor: 10000 }, { idAtividade: 11, valor: 5000 }],
  receitasBrutasAnteriores: [{ pa: 202605, valorInterno: 120000, valorExterno: 0 }],
  folhasSalario: [{ pa: 202605, valor: 3000 }],
};

describe('montarDeclaracaoPgdasd', () => {
  it('monta a estrutura do dados com pa numérico e indicadorComparacao=false', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.cnpjCompleto).toBe('10358425000120');
    expect(d.pa).toBe(202606);
    expect(d.indicadorTransmissao).toBe(false);
    expect(d.indicadorComparacao).toBe(false);
    expect(d.valoresParaComparacao).toEqual([]);
  });
  it('receitaPaCompetenciaInterno = soma das atividades; externo 0', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.declaracao.receitaPaCompetenciaInterno).toBe(15000);
    expect(d.declaracao.receitaPaCompetenciaExterno).toBe(0);
    expect(d.declaracao.tipoDeclaracao).toBe(1);
  });
  it('monta 1 estabelecimento com as atividades', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.declaracao.estabelecimentos).toHaveLength(1);
    expect(d.declaracao.estabelecimentos[0]!.cnpjCompleto).toBe('10358425000120');
    const ats = d.declaracao.estabelecimentos[0]!.atividades;
    expect(ats).toHaveLength(2);
    expect(ats[1]!.idAtividade).toBe(11);
    expect(ats[1]!.valorAtividade).toBe(5000);
    expect(ats[1]!.receitasAtividade[0]!.valor).toBe(5000);
  });
  it('repassa receitasBrutasAnteriores e folhasSalario', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: true });
    expect(d.indicadorTransmissao).toBe(true);
    expect(d.declaracao.receitasBrutasAnteriores).toEqual(base.receitasBrutasAnteriores);
    expect(d.declaracao.folhasSalario).toEqual(base.folhasSalario);
  });
});
