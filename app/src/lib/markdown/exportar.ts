// Exportação dos documentos legais para impressão/PDF e para Word.
//
// POR QUE EXISTE. O documento precisa sair da tela e chegar ao advogado num
// formato que ele consiga LER e EDITAR. Até 29/08/2026 a única saída era
// selecionar o texto do `<pre>` e copiar — o que entrega markdown cru, com
// `##` e `**`, para quem não tem por que saber o que isso significa.
//
// REUSA `parseMarkdownLegal`: o mesmo parser que a página pública e o `/aceite`
// usam. Se o documento renderiza de um jeito na tela e sai de outro no PDF, a
// versão impressa deixa de ser prova do que foi publicado — por isso a árvore é
// a mesma e só o serializador muda.
//
// ⚠️ AQUI SE ESCAPA À MÃO. `MarkdownLegal.tsx` monta elementos React, que
// escapam sozinhos; este arquivo monta STRING de HTML, onde `<` do conteúdo
// vira tag se ninguém cuidar. `esc()` é obrigatório em todo texto que entra.
import { parseMarkdownLegal, type Bloco, type Inline } from './legal';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineHtml(nodes: Inline[]): string {
  return nodes.map((n) => {
    if (n.t === 'forte') return `<strong>${esc(n.v)}</strong>`;
    if (n.t === 'codigo') return `<code>${esc(n.v)}</code>`;
    // O href já passou por `hrefSeguro` no parser; escapar de novo é barato e
    // fecha o caso de aspas dentro da URL quebrarem o atributo.
    if (n.t === 'link') return `<a href="${esc(n.href)}">${esc(n.v)}</a>`;
    return esc(n.v);
  }).join('');
}

function blocoHtml(b: Bloco): string {
  switch (b.t) {
    case 'titulo':
      return `<h${b.nivel}>${inlineHtml(b.conteudo)}</h${b.nivel}>`;
    case 'paragrafo':
      return `<p>${inlineHtml(b.conteudo)}</p>`;
    case 'lista':
      return `<ul>${b.itens.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ul>`;
    case 'citacao':
      return `<blockquote>${b.paragrafos.map((p) => `<p>${inlineHtml(p)}</p>`).join('')}</blockquote>`;
    case 'tabela':
      return '<table>'
        + `<thead><tr>${b.cabecalho.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${b.linhas.map((l) => `<tr>${l.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        + '</table>';
    case 'regua':
      return '<hr />';
  }
}

/** Só o corpo, sem `<html>` — usado pelos dois formatos abaixo. */
export function corpoHtml(md: string): string {
  return parseMarkdownLegal(md).map(blocoHtml).join('\n');
}

/** Estilo comum. Serifada de propósito: o destino é papel e Word, não a tela.
 *  Medidas em pt porque o Word ignora `rem`. */
const ESTILO = `
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; }
  p, li { margin: 0 0 8pt; }
  ul { margin: 0 0 8pt; padding-left: 18pt; }
  blockquote { margin: 10pt 0; padding: 6pt 12pt; border-left: 3pt solid #888; background: #f4f4f4; }
  blockquote p:last-child { margin-bottom: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
  th, td { border: 1pt solid #999; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #eee; }
  code { font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; background: #f0f0f0; padding: 0 2pt; }
  hr { border: 0; border-top: 1pt solid #ccc; margin: 16pt 0; }
  a { color: #0645ad; }
  .rodape-versao { margin-top: 22pt; padding-top: 8pt; border-top: 1pt solid #ccc; font-size: 9pt; color: #555; }
`;

export type MetaExport = {
  titulo: string;
  versao: string;
  /** ISO. `null` = rascunho não publicado. */
  publicadoEm: string | null;
};

/** Linha de procedência no rodapé. Um documento que sai do sistema para ser
 *  revisado por terceiro precisa dizer QUAL versão ele é — senão volta um
 *  arquivo revisado sem se saber sobre o que ele foi escrito. */
function rodape(meta: MetaExport): string {
  const estado = meta.publicadoEm
    ? `publicada em ${new Date(meta.publicadoEm).toLocaleDateString('pt-BR')}`
    : 'rascunho — ainda não publicada';
  const gerado = new Date().toLocaleString('pt-BR');
  return `<p class="rodape-versao">Versão ${esc(meta.versao)} — ${esc(estado)}.<br />`
    + `Documento gerado pelo Balu em ${esc(gerado)}.</p>`;
}

/** HTML completo para impressão (o navegador salva como PDF pelo próprio
 *  diálogo — sem biblioteca de PDF no projeto). */
export function htmlParaImpressao(md: string, meta: MetaExport): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8" />`
    + `<title>${esc(meta.titulo)} — versão ${esc(meta.versao)}</title>`
    + `<style>@page { margin: 2cm; } ${ESTILO}</style></head><body>`
    + corpoHtml(md) + rodape(meta)
    + `</body></html>`;
}

/**
 * HTML no dialeto que o Word abre como documento editável (salvo com extensão
 * `.doc`).
 *
 * POR QUE NÃO `.docx` DE VERDADE: `.docx` é um ZIP de XML e exigiria uma
 * biblioteca. O Word e o Google Docs abrem este formato há duas décadas, o
 * advogado consegue editar e usar controle de alterações, e o projeto não ganha
 * dependência nenhuma. O `xmlns:w` e o bloco `w:WordDocument` são o que faz o
 * Word tratar o arquivo como documento, e não como página web importada.
 */
export function htmlParaWord(md: string, meta: MetaExport): string {
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" `
    + `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">`
    + `<head><meta charset="utf-8" />`
    + `<title>${esc(meta.titulo)} — versão ${esc(meta.versao)}</title>`
    + `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>`
    + `<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->`
    + `<style>@page WordSection1 { margin: 2cm; } div.WordSection1 { page: WordSection1; } ${ESTILO}</style>`
    + `</head><body><div class="WordSection1">`
    + corpoHtml(md) + rodape(meta)
    + `</div></body></html>`;
}

/** `Politica-de-Privacidade-v1.0.doc` — sem acento e sem espaço, porque o nome
 *  viaja por e-mail e por sistemas que ainda tropeçam neles. */
export function nomeArquivo(titulo: string, versao: string, extensao: string): string {
  const base = titulo
    // `\p{Diacritic}` em vez do intervalo de combinantes: aqueles caracteres
    // sao invisiveis no editor e nao sobrevivem a uma copia desatenta.
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-v${versao.replace(/[^0-9.]/g, '')}.${extensao}`;
}
