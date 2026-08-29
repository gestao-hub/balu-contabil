// Testes do parser dos documentos legais (BUG-001).
//
// O caso que mais importa aqui NÃO é "renderiza negrito": é o conjunto de
// guardas que impede o parser de piorar a página. Um documento jurídico
// público que some, quebra ou executa script é pior do que o Markdown cru que
// existia antes — então cada guarda tem teste próprio.
import { describe, it, expect } from 'vitest';
import { parseMarkdownLegal, parseInline, hrefSeguro, type Bloco } from './legal';

const tipos = (bs: Bloco[]) => bs.map((b) => b.t);

describe('parseInline', () => {
  it('separa negrito, codigo e texto', () => {
    expect(parseInline('Olá **mundo** e `codigo` fim')).toEqual([
      { t: 'texto', v: 'Olá ' },
      { t: 'forte', v: 'mundo' },
      { t: 'texto', v: ' e ' },
      { t: 'codigo', v: 'codigo' },
      { t: 'texto', v: ' fim' },
    ]);
  });

  it('marcacao nao fechada continua sendo texto, e nao some', () => {
    // O caso real: alguem escreve "margem de 100% * 2" no documento.
    const r = parseInline('margem de 100% * 2');
    expect(r).toEqual([{ t: 'texto', v: 'margem de 100% * 2' }]);
  });

  it('link http vira link', () => {
    expect(parseInline('veja [aqui](https://balucontabil.com.br)')).toEqual([
      { t: 'texto', v: 'veja ' },
      { t: 'link', v: 'aqui', href: 'https://balucontabil.com.br' },
    ]);
  });

  // A guarda que justifica devolver arvore em vez de HTML.
  it('href javascript: NAO vira link — cai para o texto literal', () => {
    // A asserção é sobre COMPORTAMENTO, não sobre o formato do split: com
    // parênteses aninhados na URL o regex fecha no primeiro `)`, então o texto
    // recusado pode voltar em mais de um nó. O que não pode variar é isto:
    // zero links, e nenhum pedaço do documento perdido pelo caminho.
    const entrada = 'clique [aqui](javascript:alert(1))';
    const r = parseInline(entrada);
    expect(r.some((i) => i.t === 'link')).toBe(false);
    expect(r.map((i) => (i.t === 'texto' ? i.v : '')).join('')).toBe(entrada);
  });

  it('href javascript: sem parenteses aninhados tambem e recusado', () => {
    expect(parseInline('[x](javascript:void 0)')).toEqual([
      { t: 'texto', v: '[x](javascript:void 0)' },
    ]);
  });
});

describe('hrefSeguro', () => {
  it('aceita http, https, mailto e relativo', () => {
    expect(hrefSeguro('https://x.com')).toBe('https://x.com');
    expect(hrefSeguro('http://x.com')).toBe('http://x.com');
    expect(hrefSeguro('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(hrefSeguro('/documentos/termos')).toBe('/documentos/termos');
    expect(hrefSeguro('#secao-7')).toBe('#secao-7');
  });

  it('recusa javascript:, data: e vbscript:, inclusive disfarcados', () => {
    expect(hrefSeguro('javascript:alert(1)')).toBeNull();
    expect(hrefSeguro('  JaVaScRiPt:alert(1)')).toBeNull();
    expect(hrefSeguro('data:text/html,<script>')).toBeNull();
    expect(hrefSeguro('vbscript:msgbox')).toBeNull();
  });

  // `//host` começa com `/` mas NÃO é caminho relativo: o navegador resolve
  // como protocol-relative, ou seja navegação externa. A primeira versão
  // aceitava, e o renderizador nem aplicaria `rel="noopener"` (ele só olha
  // `http`), então o link sairia sem nenhuma das duas proteções.
  it('recusa URL protocol-relative, que parece caminho mas e externa', () => {
    expect(hrefSeguro('//evil.com')).toBeNull();
    expect(hrefSeguro('  //evil.com/x')).toBeNull();
    expect(hrefSeguro('///evil.com')).toBeNull();
  });
});

describe('parseMarkdownLegal — blocos', () => {
  it('titulo, paragrafo e regua', () => {
    const bs = parseMarkdownLegal('# Título\n\nUm parágrafo.\n\n---\n');
    expect(tipos(bs)).toEqual(['titulo', 'paragrafo', 'regua']);
    expect(bs[0]).toMatchObject({ t: 'titulo', nivel: 1 });
  });

  it('linhas consecutivas viram UM paragrafo (regra do Markdown)', () => {
    const bs = parseMarkdownLegal('primeira linha\nsegunda linha\n\noutro');
    expect(tipos(bs)).toEqual(['paragrafo', 'paragrafo']);
    expect(bs[0]).toEqual({ t: 'paragrafo', conteudo: [{ t: 'texto', v: 'primeira linha segunda linha' }] });
  });

  it('lista agrupa itens consecutivos num bloco so', () => {
    const bs = parseMarkdownLegal('- um\n- dois\n- três\n');
    expect(tipos(bs)).toEqual(['lista']);
    expect(bs[0]).toMatchObject({ t: 'lista' });
    if (bs[0].t === 'lista') expect(bs[0].itens).toHaveLength(3);
  });

  it('citacao junta as linhas e sai do bloco na primeira linha sem >', () => {
    const bs = parseMarkdownLegal('> aviso em\n> duas linhas\n\ndepois');
    expect(tipos(bs)).toEqual(['citacao', 'paragrafo']);
    if (bs[0].t === 'citacao') {
      expect(bs[0].paragrafos).toHaveLength(1);
      expect(bs[0].paragrafos[0]).toEqual([{ t: 'texto', v: 'aviso em duas linhas' }]);
    }
  });

  it('tabela com cabecalho e linhas', () => {
    const md = '| Operador | Finalidade |\n| --- | --- |\n| Resend | E-mails |\n| Asaas | Cobrança |\n';
    const bs = parseMarkdownLegal(md);
    expect(tipos(bs)).toEqual(['tabela']);
    if (bs[0].t === 'tabela') {
      expect(bs[0].cabecalho).toHaveLength(2);
      expect(bs[0].linhas).toHaveLength(2);
      expect(bs[0].linhas[0][0]).toEqual([{ t: 'texto', v: 'Resend' }]);
    }
  });

  // Sem esta exigencia, qualquer frase com "|" viraria tabela e o texto sumiria
  // da pagina — o modo mais silencioso de perder conteudo juridico.
  it('paragrafo com pipe NAO vira tabela sem a linha separadora', () => {
    const bs = parseMarkdownLegal('Os dados a | b não são compartilhados.');
    expect(tipos(bs)).toEqual(['paragrafo']);
  });

  it('documento vazio devolve lista vazia, sem lancar', () => {
    expect(parseMarkdownLegal('')).toEqual([]);
    expect(parseMarkdownLegal('\n\n  \n')).toEqual([]);
  });

  it('nao perde conteudo: todo texto de entrada reaparece na saida', () => {
    // Rede contra o parser "comer" uma linha ao trocar de bloco — o erro mais
    // caro aqui, porque some sem erro nenhum.
    const md = [
      '# Política',
      '',
      'Introdução com **negrito**.',
      '',
      '## 1. Dados',
      '- e-mail',
      '- telefone',
      '',
      '> Aviso importante.',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Fim.',
    ].join('\n');
    const texto = JSON.stringify(parseMarkdownLegal(md));
    for (const esperado of ['Política', 'Introdução com ', 'negrito', '1. Dados', 'e-mail',
      'telefone', 'Aviso importante.', 'A', 'B', '1', '2', 'Fim.']) {
      expect(texto).toContain(esperado);
    }
  });
});
