import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
}));
vi.mock('@/lib/fiscal/serpro-pagamentos', () => ({ consultarPagamentosDas: h.consultar }));

import { rodarPagamentosSerpro } from './pagamentos-serpro-cron';

/**
 * Mock do client admin no mesmo espírito do teste da conciliação: fábrica de
 * query builders encadeáveis, resposta por tabela vinda do `estado`.
 *
 * `guias_fiscais` é consultada DUAS vezes com formas diferentes — a varredura
 * de quem tem guia em aberto (base inteira, sem `eq`) e as guias DAQUELA
 * empresa (com `eq`). É por esse `eq` que o mock troca a resposta.
 */
function fazerAdmin(estado: {
  fiscais?: unknown[];
  abertas?: unknown[];
  guiasDaEmpresa?: unknown[];
  rpcResposta?: unknown;
  rpcErro?: { message: string } | null;
}) {
  const rpc = vi.fn(async () => ({
    data: estado.rpcResposta ?? { ok: true, ja_estava_paga: false },
    error: estado.rpcErro ?? null,
  }));
  const carimbos: unknown[] = [];

  function builder(tabela: string) {
    let usouEq = false;
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    for (const m of ['select', 'is', 'neq', 'order', 'limit']) q[m] = vi.fn(encadeia);
    q.eq = vi.fn(() => { usouEq = true; return q; });
    q.update = vi.fn((vals: unknown) => {
      carimbos.push(vals);
      return { eq: vi.fn(async () => ({ data: null, error: null })) };
    });
    q.then = (resolve: (v: unknown) => void) => {
      const alvo =
        tabela === 'empresas_fiscais' ? (estado.fiscais ?? [])
        : tabela === 'guias_fiscais' ? (usouEq ? (estado.guiasDaEmpresa ?? []) : (estado.abertas ?? []))
        : [];
      resolve({ data: alvo, error: null });
    };
    return q;
  }

  return { admin: { from: vi.fn(builder), rpc } as never, rpc, carimbos };
}

const FISCAL_SIMPLES = { empresa_id: 'emp1', Code_regime_tributario: '1', consulta_pagamentos_serpro_em: null };
const GUIA_ABERTA = { id: 'g1', competencia_referencia: '202604', numero_das: '07202610733758790' };

function pagamento(over: Record<string, unknown> = {}) {
  return {
    competencia: '202604',
    numeroDocumento: '7202610733758790',
    valorTotal: 123.45, valorPrincipal: 120, valorMulta: 1.45, valorJuros: 2,
    dataVencimento: '2026-05-20', dataPagamento: '2026-05-18',
    ...over,
  };
}

beforeEach(() => { h.consultar.mockReset(); });

describe('rodarPagamentosSerpro', () => {
  it('sem empresa elegível, não fala com a SERPRO', async () => {
    const { admin } = fazerAdmin({ fiscais: [], abertas: [] });
    const r = await rodarPagamentosSerpro(admin);
    expect(r).toMatchObject({ elegiveis: 0, consultadas: 0, baixadas: 0 });
    expect(h.consultar).not.toHaveBeenCalled();
  });

  it('empresa sem guia em aberto não gasta chamada', async () => {
    const { admin } = fazerAdmin({ fiscais: [FISCAL_SIMPLES], abertas: [] });
    const r = await rodarPagamentosSerpro(admin);
    expect(r.elegiveis).toBe(0);
    expect(h.consultar).not.toHaveBeenCalled();
  });

  it('MEI não entra na varredura', async () => {
    const { admin } = fazerAdmin({
      fiscais: [{ ...FISCAL_SIMPLES, Code_regime_tributario: '3' }],
      abertas: [{ company_id: 'emp1' }],
    });
    const r = await rodarPagamentosSerpro(admin);
    expect(r.elegiveis).toBe(0);
    expect(h.consultar).not.toHaveBeenCalled();
  });

  it('DAS pago vira baixa PELA RPC, com origem serpro e a data da arrecadação', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [pagamento()] });
    const { admin, rpc } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);

    expect(r).toMatchObject({ elegiveis: 1, consultadas: 1, baixadas: 1, erros: 0 });
    expect(rpc).toHaveBeenCalledWith('registrar_pagamento_guia', expect.objectContaining({
      p_guia_id: 'g1',
      p_origem: 'serpro',
      // A data é a da ARRECADAÇÃO, não a de hoje: o cron pode rodar dias depois
      // e a data do pagamento não é a da execução.
      p_data_pagamento: '2026-05-18',
    }));
  });

  it('guia que já estava paga não conta como baixa nova', async () => {
    // Senão o relatório do cron reportaria baixa nova todo dia sobre a mesma
    // guia, e o número deixaria de servir para saber se algo aconteceu.
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [pagamento()] });
    const { admin } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
      guiasDaEmpresa: [GUIA_ABERTA],
      rpcResposta: { ok: true, ja_estava_paga: true },
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.baixadas).toBe(0);
    expect(r.consultadas).toBe(1);
  });

  it('DAS pago sem data de arrecadação não vira baixa — e é contado', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [pagamento({ dataPagamento: null })] });
    const { admin, rpc } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.sem_data).toBe(1);
    expect(r.baixadas).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('número do documento que não casa não dá baixa em guia nenhuma', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [pagamento({ numeroDocumento: '999' })] });
    const { admin, rpc } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.baixadas).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consulta que falha conta erro, carimba a vez da empresa e segue', async () => {
    // O carimbo vale para a falha também: sem ele, empresa com Termo vencido
    // voltaria para a frente da fila todo dia e comeria o orçamento das outras.
    h.consultar.mockResolvedValue({ ok: false, error: 'Termo não autorizado' });
    const { admin, carimbos, rpc } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.erros).toBe(1);
    expect(r.consultadas).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(carimbos).toHaveLength(1);
    expect(carimbos[0]).toHaveProperty('consulta_pagamentos_serpro_em');
  });

  it('exceção em uma empresa não derruba a varredura', async () => {
    h.consultar
      .mockRejectedValueOnce(new Error('rede caiu'))
      .mockResolvedValueOnce({ ok: true, pagamentos: [pagamento()] });
    const { admin } = fazerAdmin({
      fiscais: [
        { ...FISCAL_SIMPLES, empresa_id: 'empA' },
        { ...FISCAL_SIMPLES, empresa_id: 'empB' },
      ],
      abertas: [{ company_id: 'empA' }, { company_id: 'empB' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.erros).toBe(1);
    expect(r.baixadas).toBe(1);
  });

  it('corta por orçamento em vez de estourar o wall-clock do cron', async () => {
    // Timeout de wall-clock não é capturável por try/catch: se a invocação
    // morrer aqui, o resumo do cron nunca chega e nada retenta.
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const { admin } = fazerAdmin({
      fiscais: [
        { ...FISCAL_SIMPLES, empresa_id: 'empA' },
        { ...FISCAL_SIMPLES, empresa_id: 'empB' },
      ],
      abertas: [{ company_id: 'empA' }, { company_id: 'empB' }],
    });

    const r = await rodarPagamentosSerpro(admin, { orcamentoMs: 0 });
    expect(r.cortada_por_orcamento).toBe(true);
    expect(r.consultadas).toBe(0);
    expect(r.elegiveis).toBe(2);
  });
});
