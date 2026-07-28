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
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: null, percentual: -5 }).ok).toBe(false);
  });

  // 100% exato e o limite ACEITO. Sem este caso, trocar `> 100` por `>= 100`
  // no validador deixaria a suite inteira verde — e taxa de urgencia de 100%
  // (dobrar o preco do servico-base) e configuracao legitima.
  it('aceita exatamente 100%', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: null, percentual: 100 }))
      .toEqual({ ok: true });
  });

  // Sem estes dois, remover `|| s.valorCentavos <= 0` do validador deixaria a
  // suite verde: o caso "recusa fixo sem valor" usa `null`, que o `!valorCentavos`
  // sozinho ja mata. E `> 0` e justamente o que o CHECK do banco exige.
  it.each([0, -1])('recusa fixo com valor %i', (v) => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'fixo', valorCentavos: v, percentual: null }).ok).toBe(false);
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

  // O docblock promete que emitir por zero e pior que recusar, mas o
  // arredondamento podia devolver 0 mesmo assim: 0,01% sobre R$ 1,00 da 0,01
  // centavo, que arredonda para 0. Devolver 0 empurraria o problema para o
  // cobrancas_escritorio_valor_check da 0053 — que barra, mas como erro de
  // Postgres na cara do escritorio em vez de recusa explicada.
  it('resultado que arredonda para zero devolve null, nao 0', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 0.01 }, 100)).toBeNull();
  });

  it.each([0, -1])('fixo com valor %i devolve null', (v) => {
    expect(valorFinalCentavos({ tipoValor: 'fixo', valorCentavos: v, percentual: null }, null)).toBeNull();
  });

  it('base negativa nao produz cobranca negativa', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 20 }, -50000)).toBeNull();
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
