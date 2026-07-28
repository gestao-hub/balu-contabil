import { describe, it, expect } from 'vitest';
import { validarServicoAvulso, valorFinalCentavos, CATALOGO_SUGERIDO } from './avulso';

describe('validarServicoAvulso', () => {
  it('aceita fixo com valor', () => {
    expect(validarServicoAvulso({ nome: 'Abertura', tipoValor: 'fixo', valorCentavos: 90000, percentual: null }))
      .toEqual({ ok: true });
  });

  it('aceita percentual com percentual', () => {
    expect(validarServicoAvulso({ nome: 'Recuperação', tipoValor: 'percentual', valorCentavos: null, percentual: 20 }))
      .toEqual({ ok: true });
  });

  it('recusa fixo sem valor', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'fixo', valorCentavos: null, percentual: null }).ok).toBe(false);
  });

  it('recusa percentual acima de 100', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: null, percentual: 101 }).ok).toBe(false);
  });

  it('recusa nome vazio', () => {
    expect(validarServicoAvulso({ nome: '  ', tipoValor: 'fixo', valorCentavos: 100, percentual: null }).ok).toBe(false);
  });

  // Espelha o CHECK do banco (migration 0053, servicos_avulsos_valor_check):
  // 'fixo' PROIBE percentual preenchido, nao so exige valorCentavos. Um teste
  // que so cobrisse "fixo exige valorCentavos" passaria mesmo se esta linha do
  // validador fosse removida — e ai a tela aceitaria o que o banco recusa.
  it('recusa fixo com percentual preenchido', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'fixo', valorCentavos: 100, percentual: 10 }).ok).toBe(false);
  });

  // Espelho do CHECK do outro lado: 'percentual' PROIBE valorCentavos preenchido.
  it('recusa percentual com valorCentavos preenchido', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: 100, percentual: 10 }).ok).toBe(false);
  });

  it('recusa percentual zero ou negativo', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: null, percentual: 0 }).ok).toBe(false);
  });
});

describe('valorFinalCentavos', () => {
  it('fixo ignora a base', () => {
    expect(valorFinalCentavos({ tipoValor: 'fixo', valorCentavos: 90000, percentual: null }, 500000)).toBe(90000);
  });

  it('percentual aplica sobre a base', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 20 }, 500000)).toBe(100000);
  });

  // Sem base nao da para calcular percentual — e cobrar 0 seria pior que
  // recusar: a cobranca sairia de graca sem ninguem notar.
  it('percentual sem base devolve null', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 20 }, null)).toBeNull();
  });

  it('arredonda o centavo para o inteiro mais proximo', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 33.33 }, 10000)).toBe(3333);
  });

  // Caso de EMPATE exato no meio-centavo (10000 * 0,125% = 12,5). A escolha
  // documentada em valorFinalCentavos e "meio para cima" (Math.round, padrao
  // comercial no Brasil) — aqui o empate tem que ir para 13, nunca para 12.
  // Sem este teste, trocar Math.round por um truncamento (Math.floor) passaria
  // no teste de 33,33% acima (que nao cai em .5) e so apareceria meses depois
  // na conciliacao do escritorio.
  it('empate exato no meio-centavo arredonda para cima', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 0.125 }, 10000)).toBe(13);
  });
});

describe('CATALOGO_SUGERIDO', () => {
  it('traz os avulsos do §5 da spec, todos validos', () => {
    expect(CATALOGO_SUGERIDO.length).toBeGreaterThanOrEqual(10);
    for (const s of CATALOGO_SUGERIDO) {
      // `?? null` nos DOIS, nunca `?? 1`: um item percentual com valorCentavos
      // preenchido e justamente o que o CHECK do banco recusa.
      const r = validarServicoAvulso({
        nome: s.nome, tipoValor: s.tipoValor,
        valorCentavos: s.valorCentavos ?? null, percentual: s.percentual ?? null,
      });
      expect(r, `servico "${s.nome}" invalido`).toEqual({ ok: true });
    }
  });

  it('recuperacao de credito e percentual', () => {
    const rec = CATALOGO_SUGERIDO.find((s) => s.nome.toLowerCase().includes('recupera'));
    expect(rec?.tipoValor).toBe('percentual');
  });
});
