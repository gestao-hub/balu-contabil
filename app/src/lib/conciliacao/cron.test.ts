import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rodarConciliacao } from './cron';

/**
 * Mock do client admin no mesmo espírito do teste do cron de obrigações: uma
 * fábrica de query builders encadeáveis, com o resultado por tabela vindo do
 * `estado`. Sem isso não dá para provar o fluxo sem um Postgres.
 */
function fazerAdmin(estado: {
  conexoes?: unknown[];
  transacoes?: unknown[];
  guias?: unknown[];
  vencidas?: unknown[];
  mock?: unknown[];
}) {
  const rpc = vi.fn(async () => ({ data: { ok: true, ja_estava_paga: false }, error: null }));
  const upserts: { tabela: string; linhas: unknown[] }[] = [];

  function builder(tabela: string) {
    const alvo =
      tabela === 'conciliacao_conexoes' ? (estado.conexoes ?? [])
      : tabela === 'conciliacao_extrato_mock' ? (estado.mock ?? [])
      : tabela === 'conciliacao_transacoes' ? (estado.transacoes ?? [])
      : tabela === 'guias_fiscais' ? (estado.guias ?? [])
      : [];

    // `guias_fiscais` é consultada duas vezes com formas diferentes: as em
    // aberto (candidatas do matcher) e as vencidas (alerta). `lt` só aparece
    // na segunda — é por ele que o mock troca a resposta.
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit', 'neq']) {
      q[m] = vi.fn(encadeia);
    }
    q.lt = vi.fn(() => ({ ...q, limit: vi.fn(async () => ({ data: estado.vencidas ?? [], error: null })) }));
    q.upsert = vi.fn((linhas: unknown[]) => {
      upserts.push({ tabela, linhas });
      return { select: vi.fn(async () => ({ data: linhas, error: null })) };
    });
    // `await` no builder resolve na lista da tabela.
    q.then = (resolve: (v: unknown) => void) => resolve({ data: alvo, error: null });
    return q;
  }

  return { admin: { from: vi.fn(builder), rpc } as never, rpc, upserts };
}

beforeEach(() => {
  delete process.env.OPEN_FINANCE_PROVEDOR;
});

describe('rodarConciliacao', () => {
  it('sem conexão ativa, não faz nada — nem chama o provedor', async () => {
    const { admin, rpc } = fazerAdmin({ conexoes: [] });
    const r = await rodarConciliacao(admin);
    expect(r).toMatchObject({ conexoes: 0, importadas: 0, conciliadas: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('dá baixa no match inequívoco, chamando o ponto de escrita único', async () => {
    const { admin, rpc } = fazerAdmin({
      conexoes: [{ id: 'cx1', company_id: 'emp1', provedor: 'mock' }],
      mock: [{ id_externo: 'tx1', data: '2026-02-20', valor_centavos: 50000, tipo: 'credito', descricao: 'DAS' }],
      transacoes: [{ id: 'tdb1', valor_centavos: 50000, data: '2026-02-20', tipo: 'credito' }],
      guias: [{ id: 'g1', valor_total: '500.00', data_vencimento: '2026-02-20' }],
      vencidas: [],
    });

    const r = await rodarConciliacao(admin);

    expect(r.conciliadas).toBe(1);
    expect(rpc).toHaveBeenCalledWith('registrar_pagamento_guia', expect.objectContaining({
      p_guia_id: 'g1', p_origem: 'conciliacao', p_transacao_id: 'tdb1',
      // A data do pagamento é a do EXTRATO, não a de hoje: o cron pode rodar
      // dias depois e a competência do pagamento não é a da execução.
      p_data_pagamento: '2026-02-20',
    }));
  });

  it('ambíguo vira sugestão e NÃO chama a baixa', async () => {
    const { admin, rpc } = fazerAdmin({
      conexoes: [{ id: 'cx1', company_id: 'emp1', provedor: 'mock' }],
      transacoes: [{ id: 'tdb1', valor_centavos: 50000, data: '2026-02-20', tipo: 'credito' }],
      guias: [
        { id: 'g1', valor_total: '500.00', data_vencimento: '2026-02-20' },
        { id: 'g2', valor_total: '500.00', data_vencimento: '2026-03-05' },
      ],
      vencidas: [],
    });

    const r = await rodarConciliacao(admin);

    expect(r.conciliadas).toBe(0);
    expect(r.sugestoes).toBe(2);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('guia vencida há mais de 3 dias gera o alerta de não detectado', async () => {
    const { admin, upserts } = fazerAdmin({
      conexoes: [{ id: 'cx1', company_id: 'emp1', provedor: 'mock' }],
      transacoes: [],
      guias: [],
      vencidas: [{ id: 'g9', data_vencimento: '2026-01-10', company_id: 'emp1', companies: { user_id: 'u1' } }],
    });

    const r = await rodarConciliacao(admin);

    expect(r.alertas).toBe(1);
    const notif = upserts.find((u) => u.tabela === 'notifications');
    expect(notif?.linhas[0]).toMatchObject({
      tipo: 'pagamento_nao_detectado', owner_user_id: 'u1',
      chave: 'pagamento_nao_detectado:g9',
    });
  });

  it('guia vencida de empresa SEM dono não vira notificação órfã', async () => {
    const { admin, upserts } = fazerAdmin({
      conexoes: [{ id: 'cx1', company_id: 'emp1', provedor: 'mock' }],
      transacoes: [], guias: [],
      vencidas: [{ id: 'g9', data_vencimento: '2026-01-10', company_id: 'emp1', companies: { user_id: null } }],
    });

    const r = await rodarConciliacao(admin);

    expect(r.alertas).toBe(0);
    expect(upserts.find((u) => u.tabela === 'notifications')).toBeUndefined();
  });

  it('provedor desconhecido falha alto, em vez de cair no mock calado', async () => {
    // Cair no mock em silêncio faria parecer que a integração real está
    // rodando — e ninguém descobriria até um cliente cobrar.
    process.env.OPEN_FINANCE_PROVEDOR = 'pluggy';
    const { admin } = fazerAdmin({ conexoes: [{ id: 'cx1', company_id: 'emp1', provedor: 'pluggy' }] });
    await expect(rodarConciliacao(admin)).rejects.toThrow(/desconhecido/i);
  });
});
