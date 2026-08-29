import { describe, it, expect } from 'vitest';
import { esc, corpoHtml, htmlParaImpressao, htmlParaWord, nomeArquivo } from './exportar';

const META = { titulo: 'Política de Privacidade', versao: '1.0', publicadoEm: '2026-08-20T12:00:00Z' };

describe('esc', () => {
  it('neutraliza os cinco caracteres que quebram HTML', () => {
    expect(esc('<script>alert("x") & \'y\'</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
  });
});

describe('corpoHtml', () => {
  it('converte a árvore inteira', () => {
    const html = corpoHtml('# T\n\nUm **negrito**.\n\n- a\n- b\n\n> nota\n\n---\n');
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<strong>negrito</strong>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<blockquote><p>nota</p></blockquote>');
    expect(html).toContain('<hr />');
  });

  it('tabela vira thead/tbody', () => {
    const html = corpoHtml('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  // A diferença que este arquivo tem para o MarkdownLegal.tsx: lá o React
  // escapa sozinho, aqui é string. Se `esc` sumir de `inlineHtml`, o conteúdo
  // do banco passa a ser interpretado como marcação no arquivo exportado.
  it('conteudo com HTML dentro NAO vira marcacao no arquivo', () => {
    const html = corpoHtml('O operador <script>alert(1)</script> trata dados.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('aspas dentro do texto de um link nao quebram o atributo', () => {
    const html = corpoHtml('[a"b](https://x.com/?q="1")');
    expect(html).not.toMatch(/href="https:\/\/x\.com\/\?q="1""/);
    expect(html).toContain('&quot;');
  });
});

describe('htmlParaImpressao', () => {
  it('e um documento completo, com charset e titulo', () => {
    const html = htmlParaImpressao('# Oi', META);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('Política de Privacidade — versão 1.0');
    expect(html).toContain('@page');
  });

  // Procedência: um arquivo que sai para revisão externa precisa dizer de qual
  // versão ele veio, senão volta revisado sem se saber sobre o quê.
  it('carimba a versao e o estado no rodape', () => {
    expect(htmlParaImpressao('# Oi', META)).toContain('Versão 1.0 — publicada em');
  });

  it('rascunho e identificado como rascunho, e nao como publicado', () => {
    const html = htmlParaImpressao('# Oi', { ...META, publicadoEm: null });
    expect(html).toContain('rascunho — ainda não publicada');
    expect(html).not.toContain('publicada em');
  });
});

describe('htmlParaWord', () => {
  it('traz o dialeto que faz o Word abrir como documento', () => {
    const html = htmlParaWord('# Oi', META);
    expect(html).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
    expect(html).toContain('w:WordDocument');
    expect(html).toContain('class="WordSection1"');
  });

  it('declara charset — sem ele o Word estraga os acentos', () => {
    expect(htmlParaWord('# Ação e conclusão', META)).toContain('<meta charset="utf-8" />');
  });
});

describe('nomeArquivo', () => {
  it('sem acento e sem espaco', () => {
    expect(nomeArquivo('Política de Privacidade', '1.0', 'doc'))
      .toBe('Politica-de-Privacidade-v1.0.doc');
    expect(nomeArquivo('Termos de Uso', '2.1', 'pdf'))
      .toBe('Termos-de-Uso-v2.1.pdf');
  });

  it('versao com sujeira nao vira nome de arquivo invalido', () => {
    expect(nomeArquivo('Termos de Uso', '1.0-rascunho/2', 'doc'))
      .toBe('Termos-de-Uso-v1.02.doc');
  });
});
