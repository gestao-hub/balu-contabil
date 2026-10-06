import { describe, it, expect } from 'vitest';
import {
  parseIndicador, parseListaMensagens, parseDetalhe, montarAssunto, montarCorpo, htmlParaTexto, dataDaReceita,
} from './serpro-caixa-postal-parse';

const env = (dados: unknown) => ({ status: 200, mensagens: [], dados: JSON.stringify(dados) });

describe('parseIndicador', () => {
  it('lê o indicador direto ou dentro de conteudo[0]', () => {
    expect(parseIndicador(env({ codigo: 0, indicadorMensagensNovas: 2 }))).toBe(2);
    expect(parseIndicador(env({ codigo: 0, conteudo: [{ indicadorMensagensNovas: '0' }] }))).toBe(0);
  });
  it('sem indicador devolve null (não inventa "nada novo")', () => {
    expect(parseIndicador(env({ codigo: 0 }))).toBeNull();
    expect(parseIndicador({ dados: '' })).toBeNull();
  });
});

describe('parseListaMensagens', () => {
  const msg = {
    isn: 82838, numeroControle: '2026/000000000000123', assuntoModelo: 'Intimação ++VARIAVEL++',
    valorParametroAssunto: 'nº 123', descricaoOrigem: 'Receita Federal', relevancia: 2,
    dataEnvio: 20261005, indicadorLeitura: 0, dataCiencia: 0,
  };

  it('monta o resumo com assunto substituído e datas ISO', () => {
    const r = parseListaMensagens(env({ codigo: 0, indicadorUltimaPagina: 'S', listaMensagens: [msg] }));
    expect(r.mensagens).toEqual([{
      isn: '82838', numeroControle: '2026/000000000000123', assunto: 'Intimação nº 123',
      origem: 'Receita Federal', relevante: true, dataEnvio: '2026-10-05', lidaNaReceita: false, dataCiencia: null,
    }]);
    expect(r.ultimaPagina).toBe(true);
    expect(r.proximoPonteiro).toBeNull();
  });

  it('paginação: N = há mais, com ponteiro', () => {
    const r = parseListaMensagens(env({ conteudo: [{ indicadorUltimaPagina: 'N', ponteiroProximaPagina: '999', listaMensagens: [] }] }));
    expect(r.ultimaPagina).toBe(false);
    expect(r.proximoPonteiro).toBe('999');
  });

  it('mensagem sem isn é descartada; dados inválidos lançam', () => {
    expect(parseListaMensagens(env({ listaMensagens: [{ assuntoModelo: 'x' }] })).mensagens).toHaveLength(0);
    expect(() => parseListaMensagens({ dados: '{quebrado' })).toThrow();
  });
});

describe('parseDetalhe', () => {
  it('substitui variáveis no corpo e devolve TEXTO, sem HTML', () => {
    const d = parseDetalhe(env({
      codigo: 0,
      conteudo: [{
        isn: '1', assuntoModelo: 'Aviso', corpoModelo: '<p>Prezado ++1++,</p><p>prazo de <b>++2++</b> dias.<script>x</script></p>',
        variaveis: ['Fulano', '30'], dataEnvio: '20261001', dataLeitura: '20261006', relevancia: 1,
      }],
    }));
    expect(d?.corpo).toBe('Prezado Fulano,\nprazo de 30 dias.x');
    expect(d?.corpo).not.toMatch(/</);
    expect(d?.lidaNaReceita).toBe(true);
  });
  it('sem mensagem devolve null', () => {
    expect(parseDetalhe(env({ codigo: 0, conteudo: [] }))).toBeNull();
  });
});

describe('auxiliares', () => {
  it('montarAssunto cai num título padrão quando vazio', () => {
    expect(montarAssunto('', '')).toBe('Mensagem da Receita Federal');
  });
  it('montarCorpo deixa vazio a variável que não veio', () => {
    expect(montarCorpo('a ++1++ b ++3++', ['x'])).toBe('a x b ');
  });
  it('htmlParaTexto decodifica entidades', () => {
    expect(htmlParaTexto('A&nbsp;&amp;&nbsp;B<br>C')).toBe('A & B\nC');
  });
  it('dataDaReceita', () => {
    expect(dataDaReceita(20261231)).toBe('2026-12-31');
    expect(dataDaReceita(0)).toBeNull();
  });
});
