// Parser do subconjunto de Markdown usado nos DOCUMENTOS LEGAIS (termos de uso
// e política de privacidade).
//
// POR QUE EXISTE (BUG-001, auditoria 29/08/2026). As páginas públicas
// `/documentos/termos` e `/documentos/privacidade` — e o gate `/aceite` —
// jogavam `conteudo_md` cru dentro de um `<pre>`. Quem abria lia `## 7. Seus
// direitos` e `**Encarregado:**` com a sintaxe à mostra, num documento que é
// peça jurídica pública.
//
// POR QUE NÃO `react-markdown`. O subconjunto que estes documentos usam é
// fechado e pequeno — títulos, listas, citações, UMA tabela, régua, e três
// marcações inline. Foi conferido nos dois arquivos (`docs/legal/*.md`) antes
// de escrever isto. Trazer remark/micromark para cobrir CommonMark inteiro
// custaria dezenas de dependências transitivas num projeto que tem treze em
// runtime, e a poucos dias do piloto.
//
// SEGURANÇA. Devolve uma árvore de dados, nunca HTML — quem renderiza monta
// elementos React (`components/MarkdownLegal.tsx`), então não há
// `dangerouslySetInnerHTML` em lugar nenhum e a questão de XSS não se coloca,
// mesmo o texto vindo do banco. A única exceção que precisa de guarda explícita
// é o href de link, tratado em `hrefSeguro`.
//
// DEGRADAÇÃO. Sintaxe fora do subconjunto vira texto literal, que é exatamente
// o que a tela mostrava antes — nunca uma exceção, nunca uma página em branco.
// O documento continua legível se o admin escrever algo que este parser não
// conhece.

export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'forte'; v: string }
  | { t: 'codigo'; v: string }
  | { t: 'link'; v: string; href: string };

export type Bloco =
  | { t: 'titulo'; nivel: 1 | 2 | 3 | 4 | 5 | 6; conteudo: Inline[] }
  | { t: 'paragrafo'; conteudo: Inline[] }
  | { t: 'lista'; itens: Inline[][] }
  | { t: 'citacao'; paragrafos: Inline[][] }
  | { t: 'tabela'; cabecalho: Inline[][]; linhas: Inline[][][] }
  | { t: 'regua' };

/** `javascript:` num href é a única porta de XSS que sobra quando a saída é
 *  árvore React. Só estes três esquemas passam; o resto vira texto puro. */
export function hrefSeguro(href: string): string | null {
  const limpo = href.trim();
  if (/^(https?:|mailto:)/i.test(limpo)) return limpo;
  // Relativo (começa com / ou #) é seguro e aparece nos documentos internos.
  if (/^[/#]/.test(limpo)) return limpo;
  return null;
}

const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

/** Quebra uma linha em texto/negrito/código/link. Marcação não fechada fica
 *  como texto — é o caso que mais aparece quando alguém escreve `100% * 2`. */
export function parseInline(linha: string): Inline[] {
  const out: Inline[] = [];
  let ultimo = 0;
  for (const m of linha.matchAll(INLINE_RE)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) out.push({ t: 'texto', v: linha.slice(ultimo, inicio) });
    if (m[1] !== undefined) {
      out.push({ t: 'forte', v: m[1] });
    } else if (m[2] !== undefined) {
      out.push({ t: 'codigo', v: m[2] });
    } else {
      const href = hrefSeguro(m[4] ?? '');
      // Link recusado não some: vira o texto que o autor escreveu, para o
      // documento não perder informação por causa da guarda.
      out.push(href ? { t: 'link', v: m[3] ?? '', href } : { t: 'texto', v: m[0] });
    }
    ultimo = inicio + m[0].length;
  }
  if (ultimo < linha.length) out.push({ t: 'texto', v: linha.slice(ultimo) });
  return out;
}

/** Divide a linha de uma tabela em células, ignorando os pipes das pontas. */
function celulas(linha: string): string[] {
  return linha.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const SEPARADOR_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseMarkdownLegal(md: string): Bloco[] {
  const linhas = md.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Bloco[] = [];

  // Buffer do parágrafo em aberto. Linhas consecutivas de texto viram um
  // parágrafo só, que é a regra do Markdown e o que os documentos assumem.
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length === 0) return;
    blocos.push({ t: 'paragrafo', conteudo: parseInline(paragrafo.join(' ')) });
    paragrafo = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const seca = linha.trim();

    if (seca === '') { fecharParagrafo(); continue; }

    // Régua antes de título: `---` sozinho é separador; sob texto seria
    // "setext heading", que estes documentos não usam.
    if (/^-{3,}$/.test(seca) || /^\*{3,}$/.test(seca)) {
      fecharParagrafo();
      blocos.push({ t: 'regua' });
      continue;
    }

    const tit = /^(#{1,6})\s+(.*)$/.exec(seca);
    if (tit) {
      fecharParagrafo();
      blocos.push({
        t: 'titulo',
        nivel: tit[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        conteudo: parseInline(tit[2]),
      });
      continue;
    }

    if (seca.startsWith('>')) {
      fecharParagrafo();
      const linhasCitacao: string[] = [];
      while (i < linhas.length && linhas[i].trim().startsWith('>')) {
        linhasCitacao.push(linhas[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      // Linha vazia dentro da citação separa parágrafos dela.
      const paragrafos: Inline[][] = [];
      let buffer: string[] = [];
      for (const l of linhasCitacao) {
        if (l.trim() === '') {
          if (buffer.length) { paragrafos.push(parseInline(buffer.join(' '))); buffer = []; }
        } else buffer.push(l);
      }
      if (buffer.length) paragrafos.push(parseInline(buffer.join(' ')));
      blocos.push({ t: 'citacao', paragrafos });
      continue;
    }

    // Tabela: só é tabela se a linha SEGUINTE for o separador `|---|---|`.
    // Sem essa exigência, qualquer parágrafo com um pipe viraria tabela.
    if (seca.includes('|') && i + 1 < linhas.length && SEPARADOR_TABELA.test(linhas[i + 1])) {
      fecharParagrafo();
      const cabecalho = celulas(seca).map(parseInline);
      i += 2;
      const linhasTabela: Inline[][][] = [];
      while (i < linhas.length && linhas[i].trim().includes('|')) {
        linhasTabela.push(celulas(linhas[i].trim()).map(parseInline));
        i++;
      }
      i--;
      blocos.push({ t: 'tabela', cabecalho, linhas: linhasTabela });
      continue;
    }

    if (/^[-*+]\s+/.test(seca)) {
      fecharParagrafo();
      const itens: Inline[][] = [];
      while (i < linhas.length && /^\s*[-*+]\s+/.test(linhas[i])) {
        itens.push(parseInline(linhas[i].trim().replace(/^[-*+]\s+/, '')));
        i++;
      }
      i--;
      blocos.push({ t: 'lista', itens });
      continue;
    }

    paragrafo.push(seca);
  }

  fecharParagrafo();
  return blocos;
}
