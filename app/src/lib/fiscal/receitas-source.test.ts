import { describe, it, expect } from 'vitest';
import { lerReceitasParaApuracao, lerNotasAnoCalendario } from './receitas-source';

/**
 * A FONTE CANÔNICA DE RECEITA, ATÉ HOJE SEM TESTE.
 *
 * ─── POR QUE ISTO IMPORTA MAIS QUE A MÉDIA ──────────────────────────────────
 * Este módulo tem SEIS consumidores — `impostos/actions.ts` (apuração e
 * declaração anual), `apuracao-cron`, `preview-imposto`, `cnae-sync` e
 * `contador/clientes/actions` — e é ele que decide QUAIS NÚMEROS entram na conta
 * do imposto. Os módulos que fazem a conta (`simples`, `rbt12`, `fator-r`,
 * `anexo-resolver`) sempre tiveram teste; o que escolhe a entrada, não.
 *
 * E a diferença aparece no tipo de erro: um erro de cálculo dá número errado e
 * alguém questiona. Um erro AQUI dá um número plausível, calculado corretamente
 * sobre uma base incompleta — e ninguém questiona.
 *
 * ─── O DEFEITO QUE MOTIVOU O ARQUIVO ────────────────────────────────────────
 * Até 01/09/2026 as duas leituras não tinham `.limit()` nem paginação. O
 * PostgREST corta em `max-rows` (1000 no padrão do Supabase) e devolve
 * `error: null` — uma página curta é indistinguível da base inteira. Um
 * comerciante com mais de mil notas na janela de 13 meses teria `receitaMes` e
 * `rbt12` calculados sobre um recorte arbitrário: faixa menor, alíquota menor,
 * imposto menor. E o mesmo array alimenta o PGDAS-D transmitido à Receita.
 */

type Linha = Record<string, unknown>;

/**
 * Stub do PostgREST que PAGINA de verdade: honra `.range(de, ate)` e devolve
 * no máximo o tamanho pedido. Um stub que devolvesse tudo de uma vez passaria
 * igual com e sem a correção — não mediria nada.
 */
function supabaseCom(linhas: Linha[]) {
  const chamadas: Array<[number, number]> = [];
  // Os filtros de CADA consulta montada, na ordem: ['eq', 'ambiente', 'prod'].
  // Sem isto o stub engole `.eq()` e um teste de filtro passaria com ou sem a
  // linha — exatamente o buraco que deixou `ambiente` de fora por três meses.
  const filtros: unknown[][] = [];
  const consulta = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'gte', 'lt']) {
      q[m] = (...args: unknown[]) => { filtros.push([m, ...args]); return q; };
    }
    for (const m of ['select', 'order']) q[m] = () => q;
    q.range = async (de: number, ate: number) => {
      chamadas.push([de, ate]);
      return { data: linhas.slice(de, ate + 1), error: null };
    };
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { from: () => consulta() } as any, chamadas, filtros };
}

function nota(iso: string, valor: number, i: number): Linha {
  return {
    id: `n${i}`, data_emissao: iso, valor_total: valor,
    status: 'ativa', tipo_documento: 'NFSe', cnae: '6201501',
  };
}

describe('lerReceitasParaApuracao', () => {
  it('mapeia cada nota para competência e valor', async () => {
    const { sb } = supabaseCom([nota('2026-08-15T12:00:00Z', 100, 1), nota('2026-07-10T12:00:00Z', 250.5, 2)]);
    const r = await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(r).toEqual([
      { competencia: '202608', valor: 100, cnae: '6201501' },
      { competencia: '202607', valor: 250.5, cnae: '6201501' },
    ]);
  });

  // O CASO QUE FECHA O DEFEITO. Mais de uma página: sem paginação, o resultado
  // seria truncado silenciosamente na primeira.
  it('lê TODAS as páginas — 1200 notas voltam 1200, não 500', async () => {
    const muitas = Array.from({ length: 1200 }, (_, i) => nota('2026-08-15T12:00:00Z', 10, i));
    const { sb, chamadas } = supabaseCom(muitas);

    const r = await lerReceitasParaApuracao(sb, 'empresa-1', '202608');

    expect(r).toHaveLength(1200);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBe(12_000);
    // 3 páginas: 0-499, 500-999, 1000-1499 (a última volta curta e encerra).
    expect(chamadas).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('para na primeira página curta, sem pedir uma página vazia à toa', async () => {
    const { sb, chamadas } = supabaseCom(Array.from({ length: 3 }, (_, i) => nota('2026-08-15T12:00:00Z', 1, i)));
    await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(chamadas).toEqual([[0, 499]]);
  });

  it('página EXATAMENTE cheia pede a seguinte — senão perderia o resto', async () => {
    const { sb, chamadas } = supabaseCom(Array.from({ length: 500 }, (_, i) => nota('2026-08-15T12:00:00Z', 1, i)));
    const r = await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(r).toHaveLength(500);
    expect(chamadas).toHaveLength(2);
  });

  it('descarta linha sem data ou sem valor, em vez de somar NaN', async () => {
    const { sb } = supabaseCom([
      nota('2026-08-15T12:00:00Z', 100, 1),
      { id: 'x', data_emissao: null, valor_total: 50 },
      { id: 'y', data_emissao: '2026-08-15T12:00:00Z', valor_total: null },
    ]);
    const r = await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(r).toHaveLength(1);
  });

  it('erro de leitura ESTOURA — nunca devolve base parcial em silêncio', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb: any = {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order']) q[m] = () => q;
        q.range = async () => ({ data: null, error: { message: 'timeout' } });
        return q;
      },
    };
    await expect(lerReceitasParaApuracao(sb, 'empresa-1', '202608')).rejects.toThrow(/timeout/);
  });

  /**
   * O DEFEITO DE 02/09/2026, medido no banco antes de ser corrigido.
   *
   * Esta leitura não filtrava `ambiente`. Como o produto oferece emissão em
   * homologação antes da produção, o cliente testa — e o teste entrava na base
   * de imposto: 100% da receita do banco era de homologação e a apuração
   * devolveu R$ 112,50 sobre ela, sem sinal nenhum. O mesmo array alimenta o
   * PGDAS-D, então a nota de teste ia declarada à Receita.
   *
   * O stub não aplica filtros (ele devolve as linhas que recebeu), então quem
   * morde a mutação é a asserção sobre a consulta MONTADA. Tirar a linha
   * `.eq('ambiente', 'prod')` do código faz este teste falhar; nenhum outro.
   */
  it('pede ao banco SÓ nota de produção — homologação é teste, não receita', async () => {
    const { sb, filtros } = supabaseCom([nota('2026-08-15T12:00:00Z', 100, 1)]);
    await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(filtros).toContainEqual(['eq', 'ambiente', 'prod']);
  });

  // Filtro POSITIVO, não negativo: `!= 'hom'` deixaria passar qualquer valor
  // novo de ambiente direto para a base de cálculo do imposto.
  it('filtra por igualdade a prod, nunca por diferença de hom', async () => {
    const { sb, filtros } = supabaseCom([nota('2026-08-15T12:00:00Z', 100, 1)]);
    await lerReceitasParaApuracao(sb, 'empresa-1', '202608');
    expect(filtros.some((f) => f[0] === 'neq')).toBe(false);
  });

  // A competência sai de `competenciaReferenciaBrt`: uma nota emitida às 22h do
  // dia 31 é do mês que acaba, não do seguinte.
  it('competência é a de Brasília, não a de UTC', async () => {
    const { sb } = supabaseCom([nota('2026-09-01T01:00:00Z', 100, 1)]); // 22:00 BRT de 31/08
    const r = await lerReceitasParaApuracao(sb, 'empresa-1', '202609');
    expect(r[0].competencia).toBe('202608');
  });
});

describe('lerNotasAnoCalendario', () => {
  it('também pagina — a janela do ano tem mais notas que a de 13 meses', async () => {
    const muitas = Array.from({ length: 700 }, (_, i) => ({
      id: `n${i}`, data_emissao: '2026-05-10T12:00:00Z', valor_total: 5, tipo_documento: 'NFSe',
    }));
    const { sb, chamadas } = supabaseCom(muitas);
    const r = await lerNotasAnoCalendario(sb, 'empresa-1', 2026);
    expect(r).toHaveLength(700);
    expect(chamadas).toEqual([[0, 499], [500, 999]]);
  });

  // Mesma regra da apuração: a declaração anual (DASN/DEFIS) não declara nota
  // de teste. As duas leituras deste arquivo tinham o mesmo furo.
  it('também pede só nota de produção', async () => {
    const { sb, filtros } = supabaseCom([
      { id: 'n1', data_emissao: '2026-05-10T12:00:00Z', valor_total: 5, tipo_documento: 'NFSe' },
    ]);
    await lerNotasAnoCalendario(sb, 'empresa-1', 2026);
    expect(filtros).toContainEqual(['eq', 'ambiente', 'prod']);
  });

  it('devolve dataEmissao crua — o recorte do ano em BRT é de quem consome', async () => {
    const { sb } = supabaseCom([
      { id: 'n1', data_emissao: '2026-12-31T23:00:00Z', valor_total: 9, tipo_documento: 'NFe' },
    ]);
    const r = await lerNotasAnoCalendario(sb, 'empresa-1', 2026);
    expect(r[0]).toEqual({ dataEmissao: '2026-12-31T23:00:00Z', valor: 9, tipoDocumento: 'NFe' });
  });
});
