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
  // Aridade declarada: mock sem parâmetros faz `rpc.mock.calls[0][1]` não
  // compilar, e é justamente o argumento que os testes de identidade da guia
  // precisam ler.
  const rpc = vi.fn(async (_nome: string, _args?: Record<string, unknown>) => ({
    data: estado.rpcResposta ?? { ok: true, ja_estava_paga: false },
    error: estado.rpcErro ?? null,
  }));
  const carimbos: unknown[] = [];

  function builder(tabela: string) {
    let usouEq = false;
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    for (const m of ['select', 'is', 'neq', 'order', 'limit', 'in']) q[m] = vi.fn(encadeia);
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

  it('Regime Normal (3) não entra na varredura — não recolhe DAS', async () => {
    // Este teste se chamava "MEI não entra" e usava o código 3, que é Regime
    // Normal. MEI é 4, e desde 14/08/2026 ELE ENTRA — ver o teste abaixo.
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

// ─── Correções de 14/08/2026 (rodada de revisão) ────────────────────────────

describe('rodarPagamentosSerpro — o carimbo da vez (0088) não pode ser pulado', () => {
  it('EXCEÇÃO na consulta ainda carimba — senão a empresa volta à frente da fila todo dia', async () => {
    // `consultarPagamentosDas` lança ANTES do try interno dela quando o PFX do
    // contratante ou o token de procurador falham. O carimbo morava depois da
    // consulta, dentro do try: a empresa com certificado quebrado nunca era
    // carimbada, e como '' ordena antes de qualquer ISO, ela reencabeçava a
    // fila todo dia e comia o orçamento das outras.
    h.consultar.mockRejectedValue(new Error('PFX ilegível'));
    const { admin, carimbos } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    const r = await rodarPagamentosSerpro(admin);

    expect(r.erros).toBe(1);
    expect(carimbos).toHaveLength(1);
    expect(carimbos[0]).toHaveProperty('consulta_pagamentos_serpro_em');
  });

  it('sucesso também carimba, uma vez só', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const { admin, carimbos } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    await rodarPagamentosSerpro(admin);
    expect(carimbos).toHaveLength(1);
  });

  it('empresa cortada pelo orçamento NÃO é carimbada — ela não teve a vez dela', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const { admin, carimbos } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    await rodarPagamentosSerpro(admin, { orcamentoMs: 0 });
    expect(carimbos).toHaveLength(0);
  });
});

describe('rodarPagamentosSerpro — a baixa vai na guia que CASOU', () => {
  it('duas guias de competência NULA: cada baixa cai na sua, não duas vezes na primeira', async () => {
    // `competencia_referencia` é nullable e NULL não colide com NULL num índice
    // único — então `uniq_guias_company_competencia` permite duas guias nulas na
    // mesma empresa (importação legada). Reencontrar a guia por competência
    // fazia as duas baixas caírem na primeira linha.
    h.consultar.mockResolvedValue({
      ok: true,
      pagamentos: [
        pagamento({ numeroDocumento: '111', dataPagamento: '2026-05-18' }),
        pagamento({ numeroDocumento: '222', dataPagamento: '2026-06-19' }),
      ],
    });
    const { admin, rpc } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
      guiasDaEmpresa: [
        { id: 'gA', competencia_referencia: null, numero_das: '111' },
        { id: 'gB', competencia_referencia: null, numero_das: '222' },
      ],
    });

    await rodarPagamentosSerpro(admin);

    const ids = rpc.mock.calls.map((c) => (c[1] as { p_guia_id: string }).p_guia_id);
    expect(ids).toEqual(['gA', 'gB']);

    // E cada uma com a data do SEU documento — trocar a guia trocaria a data.
    const datas = rpc.mock.calls.map((c) => (c[1] as { p_data_pagamento: string }).p_data_pagamento);
    expect(datas).toEqual(['2026-05-18', '2026-06-19']);
  });
});

describe('rodarPagamentosSerpro — truncamento silencioso da leitura de base', () => {
  it('leitura no teto acende `leitura_truncada` em vez de parecer saudável', async () => {
    // O PostgREST corta em `max-rows` e devolve error null. Quem ficou fora da
    // página teria guiasEmAberto 0 e sumiria da fila para sempre, com o resumo
    // do cron reportando tudo certo.
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const muitas = Array.from({ length: 5_000 }, (_, i) => ({ company_id: `emp${i}` }));
    const { admin } = fazerAdmin({ fiscais: [FISCAL_SIMPLES], abertas: muitas });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.leitura_truncada).toBe(true);
  });

  it('base pequena não acende o alarme', async () => {
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const { admin } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    const r = await rodarPagamentosSerpro(admin);
    expect(r.leitura_truncada).toBe(false);
  });
});

describe('rodarPagamentosSerpro — a janela de consulta cobre a virada do ano', () => {
  it('pede desde o ano ANTERIOR — o DAS de dezembro é pago em janeiro', async () => {
    // Sem isto, um pagamento feito em dezembro e não alcançado antes da virada
    // fica fora de toda janela futura: a guia nunca é baixada e a empresa
    // queima uma chamada SERPRO por dia para sempre.
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [] });
    const { admin } = fazerAdmin({
      fiscais: [FISCAL_SIMPLES],
      abertas: [{ company_id: 'emp1' }],
    });

    await rodarPagamentosSerpro(admin, { agora: new Date('2027-01-03T12:00:00Z') });

    expect(h.consultar).toHaveBeenCalledWith(
      expect.anything(), 'emp1', 2027, { desdeAno: 2026 },
    );
  });
});

describe('rodarPagamentosSerpro — o MEI entrou (14/08/2026)', () => {
  it('empresa MEI com guia em aberto É consultada e recebe baixa', async () => {
    // O DAS-MEI é gerado pelo app (gerarDasMeiAction, via PGMEI) e ficava sem
    // ninguém reconhecer o pagamento: a guia permanecia aberta para sempre,
    // virava 'vencida', e o cliente que pagou em dia aparecia em atraso para si
    // e para o contador (painel_contador.das_vencidos), mês após mês.
    h.consultar.mockResolvedValue({ ok: true, pagamentos: [pagamento()] });
    const { admin, rpc } = fazerAdmin({
      fiscais: [{ ...FISCAL_SIMPLES, empresa_id: 'mei1', Code_regime_tributario: '4' }],
      abertas: [{ company_id: 'mei1' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);

    expect(r).toMatchObject({ elegiveis: 1, consultadas: 1, baixadas: 1, erros: 0 });
    expect(rpc).toHaveBeenCalledWith('registrar_pagamento_guia', expect.objectContaining({
      p_origem: 'serpro',
    }));
  });

  it('MEI sem Termo falha com erro traduzido, é carimbada e não trava a fila', async () => {
    // PAGAMENTOS71 exige token de procurador — diferente do PGMEI, que gera o
    // DAS-MEI sem procuração. Quem não assinou o Termo não pode travar a
    // varredura dos outros.
    h.consultar
      .mockResolvedValueOnce({ ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' })
      .mockResolvedValueOnce({ ok: true, pagamentos: [pagamento()] });
    const { admin, carimbos } = fazerAdmin({
      fiscais: [
        { ...FISCAL_SIMPLES, empresa_id: 'meiSemTermo', Code_regime_tributario: '4' },
        { ...FISCAL_SIMPLES, empresa_id: 'simplesOk', Code_regime_tributario: '1' },
      ],
      abertas: [{ company_id: 'meiSemTermo' }, { company_id: 'simplesOk' }],
      guiasDaEmpresa: [GUIA_ABERTA],
    });

    const r = await rodarPagamentosSerpro(admin);

    expect(r.erros).toBe(1);
    expect(r.baixadas).toBe(1);       // a outra empresa seguiu normalmente
    expect(carimbos).toHaveLength(2); // as duas tiveram a vez delas
  });
});
