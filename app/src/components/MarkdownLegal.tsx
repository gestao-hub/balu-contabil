// Renderiza os documentos legais (termos e privacidade) a partir da árvore de
// `lib/markdown/legal.ts`. Ver o cabeçalho daquele arquivo para o porquê de não
// usarmos `react-markdown`.
//
// Não há `dangerouslySetInnerHTML` aqui de propósito: o conteúdo vem do banco,
// e montar elementos React a partir de uma árvore de dados tira a questão de
// XSS do caminho em vez de tentar sanitizá-la depois.
import { parseMarkdownLegal, type Bloco, type Inline } from '@/lib/markdown/legal';

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'forte') return <strong key={i} className="font-semibold text-foreground">{n.v}</strong>;
        if (n.t === 'codigo') {
          return (
            <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
              {n.v}
            </code>
          );
        }
        if (n.t === 'link') {
          // `rel` fecha o `window.opener` de link externo; o href já passou por
          // `hrefSeguro` no parser.
          return (
            <a
              key={i}
              href={n.href}
              className="text-primary underline underline-offset-2 hover:no-underline"
              {...(n.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {n.v}
            </a>
          );
        }
        return <span key={i}>{n.v}</span>;
      })}
    </>
  );
}

const TITULO_CLASSE: Record<number, string> = {
  1: 'mt-8 text-2xl font-semibold',
  2: 'mt-8 text-xl font-semibold',
  3: 'mt-6 text-lg font-semibold',
  4: 'mt-6 text-base font-semibold',
  5: 'mt-4 text-base font-semibold',
  6: 'mt-4 text-sm font-semibold',
};

function BlocoView({ b }: { b: Bloco }) {
  switch (b.t) {
    case 'titulo': {
      const Tag = `h${b.nivel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag className={`${TITULO_CLASSE[b.nivel]} text-foreground`}>
          <Inlines nodes={b.conteudo} />
        </Tag>
      );
    }
    case 'paragrafo':
      return <p className="mt-4 leading-relaxed text-muted-foreground"><Inlines nodes={b.conteudo} /></p>;
    case 'lista':
      return (
        <ul className="mt-4 list-disc space-y-1 pl-6 text-muted-foreground">
          {b.itens.map((it, i) => <li key={i} className="leading-relaxed"><Inlines nodes={it} /></li>)}
        </ul>
      );
    case 'citacao':
      return (
        <blockquote className="mt-4 border-l-2 border-primary bg-primary/5 py-2 pl-4 pr-3 text-muted-foreground">
          {b.paragrafos.map((p, i) => (
            <p key={i} className={i > 0 ? 'mt-2 leading-relaxed' : 'leading-relaxed'}>
              <Inlines nodes={p} />
            </p>
          ))}
        </blockquote>
      );
    case 'tabela':
      // A tabela de operadores da política tem 3 colunas e estoura em 390px —
      // rolagem própria, para o documento não empurrar a página de lado.
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr>
                {b.cabecalho.map((c, i) => (
                  <th key={i} className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
                    <Inlines nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.linhas.map((linha, i) => (
                <tr key={i}>
                  {linha.map((c, j) => (
                    <td key={j} className="border-b border-border px-3 py-2 align-top text-muted-foreground">
                      <Inlines nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'regua':
      return <hr className="mt-8 border-border" />;
  }
}

export default function MarkdownLegal({ md }: { md: string }) {
  const blocos = parseMarkdownLegal(md);
  return (
    <div className="text-sm">
      {blocos.map((b, i) => <BlocoView key={i} b={b} />)}
    </div>
  );
}
