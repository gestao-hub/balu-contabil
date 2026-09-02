import { describe, it, expect } from 'vitest';
import { somarEmitidoNoAno } from './emitido-ano';

/**
 * O TOTAL EMITIDO NO ANO — o número que a tela de notas mostra ao lado do teto.
 *
 * Ele não entra em declaração nenhuma, mas governa o alerta de limite do
 * Simples/MEI: é por ele que o cliente descobre que está perto de estourar a
 * faixa. Somar nota de homologação aqui gastava o teto dele com faturamento que
 * nunca existiu — e o alerta chegaria cedo demais, sobre dinheiro imaginário.
 *
 * Mesma causa e mesmo dia (02/09/2026) do defeito de `receitas-source.ts`, que
 * é onde a decisão está documentada por inteiro. Este arquivo é o irmão que
 * ficaria para trás: o próprio comentário do código diz "mesma família de
 * filtro" — e a família tinha três membros, dois deles sem o filtro.
 */
type Linha = Record<string, unknown>;

/**
 * Stub que REGISTRA os filtros montados. O stub não os aplica (devolve as
 * linhas que recebeu), então quem prova a correção é a consulta montada, não o
 * resultado — um stub que só devolvesse dados passaria com e sem a correção.
 */
function supabaseCom(linhas: Linha[]) {
  const filtros: unknown[][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'gte', 'lt']) {
    q[m] = (...args: unknown[]) => { filtros.push([m, ...args]); return q; };
  }
  q.select = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: linhas, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { from: () => q } as any, filtros };
}

describe('somarEmitidoNoAno', () => {
  it('soma o valor das notas do ano', async () => {
    const { sb } = supabaseCom([{ valor_total: 1200.5 }, { valor_total: 300 }]);
    expect(await somarEmitidoNoAno(sb, 'empresa-1', 2026)).toBe(1500.5);
  });

  it('linha sem valor não vira NaN no total', async () => {
    const { sb } = supabaseCom([{ valor_total: 100 }, { valor_total: null }]);
    expect(await somarEmitidoNoAno(sb, 'empresa-1', 2026)).toBe(100);
  });

  // A mutação mordida: apagar `.eq('ambiente', 'prod')` do código.
  it('pede ao banco SÓ nota de produção — teste não consome o teto do cliente', async () => {
    const { sb, filtros } = supabaseCom([]);
    await somarEmitidoNoAno(sb, 'empresa-1', 2026);
    expect(filtros).toContainEqual(['eq', 'ambiente', 'prod']);
  });

  it('conta emissão e lançamento manual, e recorta o ano-calendário', async () => {
    const { sb, filtros } = supabaseCom([]);
    await somarEmitidoNoAno(sb, 'empresa-1', 2026);
    expect(filtros).toContainEqual(['in', 'status', ['ativa', 'lancada']]);
    expect(filtros).toContainEqual(['gte', 'data_emissao', '2026-01-01']);
    expect(filtros).toContainEqual(['lt', 'data_emissao', '2027-01-01']);
  });
});
