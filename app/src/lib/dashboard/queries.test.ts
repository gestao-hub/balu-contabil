import { describe, it, expect } from 'vitest';
import { getDashboardMetrics } from './queries';

/**
 * O CARD DE RECEITA DO MÊS — primeira coisa que o cliente vê ao abrir o app.
 *
 * O defeito de 02/09/2026 (documentado por inteiro em
 * `lib/fiscal/receitas-source.ts`) tinha três braços: a base de imposto, o teto
 * anual e este card. Aqui ele não erra imposto nenhum, mas erra pior de outro
 * jeito: se o dashboard somasse nota de homologação e a apuração não, o mesmo
 * mês teria DOIS números na tela e nenhum dos dois explicaria o outro. O card e
 * a apuração têm de contar a mesma coisa.
 *
 * `queries.ts` não tinha teste. Este arquivo cobre a consulta MONTADA (que é o
 * que carrega a regra), não o resultado — o stub não aplica filtros, então um
 * teste de resultado passaria com e sem a correção.
 */
type Linha = Record<string, unknown>;

function supabaseCom(notas: Linha[]) {
  const filtros: Record<string, unknown[][]> = {};
  const from = (tabela: string) => {
    const registrar = (m: string) => (...args: unknown[]) => {
      (filtros[tabela] ??= []).push([m, ...args]);
      return q;
    };
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'gte', 'lt', 'neq', 'not', 'order', 'limit', 'select']) q[m] = registrar(m);
    // Terminais: `select(...).eq(...)` resolve como thenable (receita do mês);
    // `maybeSingle()` fecha as outras duas consultas.
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: tabela === 'notas_fiscais' ? notas : [], error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { from } as any, filtros };
}

describe('getDashboardMetrics — receita do mês', () => {
  it('soma o valor das notas do mês e conta quantas são', async () => {
    const { sb } = supabaseCom([{ valor_total: 800 }, { valor_total: 200.25 }]);
    const m = await getDashboardMetrics(sb, 'empresa-1');
    expect(m.receitaMes).toBe(1000.25);
    expect(m.notasMes).toBe(2);
  });

  // A mutação mordida: apagar `.eq('ambiente', 'prod')` da consulta de receita.
  it('conta SÓ nota de produção — homologação não é faturamento na tela', async () => {
    const { sb, filtros } = supabaseCom([]);
    await getDashboardMetrics(sb, 'empresa-1');
    expect(filtros.notas_fiscais).toContainEqual(['eq', 'ambiente', 'prod']);
  });

  // O card conta o que a apuração conta: autorizada e de produção. Se um dos
  // dois filtros cair, os dois números do mesmo mês voltam a divergir.
  it('conta só nota autorizada, da empresa pedida', async () => {
    const { sb, filtros } = supabaseCom([]);
    await getDashboardMetrics(sb, 'empresa-1');
    expect(filtros.notas_fiscais).toContainEqual(['eq', 'status', 'ativa']);
    expect(filtros.notas_fiscais).toContainEqual(['eq', 'company_id', 'empresa-1']);
  });
});
