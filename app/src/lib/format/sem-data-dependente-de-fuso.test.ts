import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TRAVA DO BUG-006: nenhum componente pode formatar data pelo fuso de quem
 * renderiza.
 *
 * ─── POR QUE UM TESTE QUE LÊ O CÓDIGO-FONTE ─────────────────────────────────
 * O defeito não aparece em teste de unidade: `toLocaleDateString('pt-BR')`
 * devolve string válida em qualquer ambiente. Ele só se manifesta quando
 * servidor e cliente estão em fusos diferentes — que é exatamente o que
 * acontece em produção (Vercel em UTC, navegador brasileiro em BRT) e nunca
 * acontece na máquina de quem escreve o código.
 *
 * Medido em 01/09/2026:
 *   new Date('2026-09-01T02:00:00Z').toLocaleDateString('pt-BR')
 *     Node com TZ=UTC       → "01/09/2026"
 *     Chromium em BRT       → "31/08/2026"
 *
 * Em client component isso é erro React #418 (hidratação) — o BUG-006 da
 * auditoria de 29/08. Em server component é pior e mais silencioso: o usuário
 * simplesmente vê a data errada, sem erro nenhum no console.
 *
 * Por isso a trava é sobre o FONTE, e vale para os dois tipos de componente. A
 * saída é `@/lib/format/data-brt`, que fixa `America/Sao_Paulo` nos dois lados.
 *
 * Moeda fica de fora de propósito: `Intl.NumberFormat('pt-BR', currency)` foi
 * comparado no mesmo experimento e Node e Chromium produzem string idêntica,
 * `U+00A0` inclusive.
 */

const RAIZ = join(__dirname, '..', '..');
const PROIBIDO = /\.toLocale(Date|Time)?String\s*\(/;

function varrer(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      varrer(caminho, achados);
      continue;
    }
    if (!nome.endsWith('.tsx')) continue;
    if (nome.endsWith('.test.tsx')) continue;

    const linhas = readFileSync(caminho, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      if (!PROIBIDO.test(linha)) return;
      // Moeda é segura (medido) — e é a única exceção.
      if (linha.includes('currency')) return;
      achados.push(`${caminho.slice(RAIZ.length + 1)}:${i + 1}  ${linha.trim().slice(0, 100)}`);
    });
  }
  return achados;
}

describe('nenhuma data formatada pelo fuso de quem renderiza', () => {
  it('componentes usam @/lib/format/data-brt, nunca toLocale*String direto', () => {
    const achados = varrer(join(RAIZ, 'app'));
    expect(
      achados,
      'Data formatada com o fuso do ambiente. No servidor (UTC) e no navegador ' +
      '(BRT) o resultado difere, o que dá erro de hidratação em client component ' +
      'e data errada em server component. Use dataBrt / dataHoraBrt / ' +
      'mesAnoBrt / mesAnoCompetencia de @/lib/format/data-brt.\n  ' +
      achados.join('\n  '),
    ).toEqual([]);
  });

  it('a varredura realmente olha os arquivos — senão passaria vazia para sempre', () => {
    // Guarda contra falso verde: se o caminho mudar e `varrer` passar a
    // percorrer diretório vazio, o teste acima ficaria verde sem medir nada.
    let tsx = 0;
    const contar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const c = join(dir, nome);
        if (statSync(c).isDirectory()) contar(c);
        else if (nome.endsWith('.tsx')) tsx++;
      }
    };
    contar(join(RAIZ, 'app'));
    expect(tsx, 'a varredura não encontrou componentes — o caminho mudou?').toBeGreaterThan(50);
  });
});
