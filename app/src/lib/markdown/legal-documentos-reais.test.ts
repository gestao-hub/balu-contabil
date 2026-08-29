// Evidência: o parser contra os documentos legais REAIS, não sintéticos.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdownLegal } from './legal';
import { corpoHtml } from './exportar';

// Fora de `app/`: os documentos moram em `balu/docs/legal/`. Se um dia forem
// renomeados (v2, por exemplo), o teste PULA em vez de quebrar — falhar por
// arquivo ausente seria ruido; o que interessa e falhar quando o parser deixa
// de dar conta do texto real.
const DIR = path.resolve(__dirname, '../../../../docs/legal');
const ARQUIVOS = ['politica-de-privacidade-v1.md', 'termos-de-uso-v1.md']
  .filter((n) => fs.existsSync(path.join(DIR, n)));

/** Todo texto que a árvore contém, concatenado. */
function textoDaArvore(md: string): string {
  return JSON.stringify(parseMarkdownLegal(md));
}

describe.skipIf(ARQUIVOS.length === 0)('parser contra os documentos legais reais', () => {
  for (const nome of ARQUIVOS) {
    const md = fs.readFileSync(path.join(DIR, nome), 'utf8');

    it(`${nome}: nenhuma palavra do original desaparece`, () => {
      const saida = textoDaArvore(md);
      const perdidas: string[] = [];
      for (const linha of md.split('\n')) {
        const limpa = linha.trim();
        if (!limpa || /^[-|>#*\s]*$/.test(limpa)) continue;
        // Palavras de 5+ letras, que são as que carregam conteúdo.
        for (const palavra of limpa.match(/[A-Za-zÀ-ÿ]{5,}/g) ?? []) {
          if (!saida.includes(palavra)) perdidas.push(`${palavra} (linha: ${limpa.slice(0, 50)})`);
        }
      }
      expect(perdidas.slice(0, 10)).toEqual([]);
    });

    it(`${nome}: gera HTML sem markdown cru sobrando`, () => {
      const html = corpoHtml(md);
      // Se sobrou `## ` ou `**` no HTML, algum bloco não foi reconhecido.
      expect(html).not.toMatch(/^##\s/m);
      expect(html).not.toContain('**');
    });

    it(`${nome}: estrutura reconhecida (títulos, listas e parágrafos)`, () => {
      const blocos = parseMarkdownLegal(md);
      const tipos = new Set(blocos.map((b) => b.t));
      expect(tipos.has('titulo')).toBe(true);
      expect(tipos.has('paragrafo')).toBe(true);
      expect(tipos.has('lista')).toBe(true);
      expect(blocos.length).toBeGreaterThan(20);
    });
  }

  it('a tabela de operadores da política é reconhecida como tabela', () => {
    const md = fs.readFileSync(path.join(DIR, 'politica-de-privacidade-v1.md'), 'utf8');
    const tabelas = parseMarkdownLegal(md).filter((b) => b.t === 'tabela');
    expect(tabelas.length).toBeGreaterThanOrEqual(1);
  });
});
