import { describe, it, expect, vi } from 'vitest';
import { aplicarPagamentoNaCobranca, type CobrancaDoEscritorio } from './aplicar-cobranca-escritorio';

/**
 * Mock do client no mesmo espírito dos outros crons: fábrica de query builders
 * encadeáveis, com a resposta escolhida por tabela.
 *
 * O que este arquivo prova é o AVISO (Frente 3) — a escrita do dinheiro já é
 * coberta por `cobranca-escritorio.test.ts` (a decisão pura) e por
 * `cron-escritorio.test.ts` (a varredura).
 */
function fazerClient(estado: {
  /** Linhas afetadas pelo compare-and-swap. `[]` = perdeu a corrida. */
  afetadas?: unknown[];
  empresa?: { user_id: string | null; nome: string | null; razao_social: string | null } | null;
  membros?: { user_id: string }[];
}) {
  const notificacoes: { linhas: unknown[]; opts: unknown }[] = [];

  function builder(tabela: string) {
    const q: Record<string, unknown> = {};
    const encadeia = () => q;
    for (const m of ['select', 'eq', 'is', 'neq', 'update']) q[m] = vi.fn(encadeia);
    q.maybeSingle = vi.fn(async () => ({ data: estado.empresa ?? null, error: null }));
    q.upsert = vi.fn((linhas: unknown[], opts: unknown) => {
      if (tabela === 'notifications') notificacoes.push({ linhas, opts });
      return q;
    });
    q.then = (resolve: (v: unknown) => void) => {
      const data =
        tabela === 'cobrancas_escritorio' ? (estado.afetadas ?? [{ id: 'cob1' }])
        : tabela === 'contabilidade_membros' ? (estado.membros ?? [])
        : null;
      resolve({ data, error: null });
    };
    return q;
  }

  return { sb: { from: vi.fn(builder) } as never, notificacoes };
}

const COBRANCA: CobrancaDoEscritorio = {
  id: 'cob1',
  status: 'pendente',
  pago_em: null,
  honorario_id: null,
  contabilidade_id: 'contab1',
  empresa_cliente_id: 'empresa1',
  descricao: 'Honorário de maio',
};

const PAGO = { status: 'RECEIVED', paymentDate: '2026-05-10', confirmedDate: null };

describe('avisos de pagamento confirmado (Asaas)', () => {
  it('cliente recebe a QUITAÇÃO e o escritório o RECEBIMENTO — frases diferentes', async () => {
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: 'AL Piscinas', razao_social: null },
      membros: [{ user_id: 'user_contador' }],
    });

    const r = await aplicarPagamentoNaCobranca(sb, COBRANCA, PAGO, 'webhook');

    expect(r).toMatchObject({ ok: true, mudou: true, status: 'paga' });
    expect(notificacoes).toHaveLength(1);

    const linhas = notificacoes[0].linhas as Record<string, unknown>[];
    expect(linhas).toHaveLength(2);

    const cliente = linhas.find((l) => l.owner_user_id === 'user_cliente')!;
    expect(cliente).toMatchObject({
      tipo: 'pagamento_confirmado',
      company_id: 'empresa1',
      titulo: 'Pagamento confirmado',
      chave: 'pagamento_confirmado:cobranca:cob1',
    });
    expect(cliente.corpo).toContain('confirmado pelo Asaas');

    const escritorio = linhas.find((l) => l.owner_user_id === 'user_contador')!;
    expect(escritorio).toMatchObject({
      tipo: 'pagamento_confirmado',
      company_id: null, // aviso do escritório, não de uma empresa
      titulo: 'Pagamento recebido',
      chave: 'pagamento_confirmado:cobranca:cob1:escritorio',
    });
    expect(escritorio.corpo).toContain('AL Piscinas');
  });

  it('a inserção é idempotente por (dono, chave) — o Asaas reentrega eventos', async () => {
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: 'Cliente', razao_social: null },
      membros: [],
    });

    await aplicarPagamentoNaCobranca(sb, COBRANCA, PAGO, 'webhook');

    expect(notificacoes[0].opts).toMatchObject({
      onConflict: 'owner_user_id,chave', ignoreDuplicates: true,
    });
  });

  it('estorno NÃO gera aviso de confirmação', async () => {
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: 'Cliente', razao_social: null },
      membros: [{ user_id: 'user_contador' }],
    });

    const r = await aplicarPagamentoNaCobranca(
      sb, COBRANCA, { status: 'REFUNDED', paymentDate: null, confirmedDate: null }, 'webhook',
    );

    expect(r).toMatchObject({ mudou: true, status: 'estornada' });
    expect(notificacoes).toHaveLength(0);
  });

  it('evento sem efeito (reentrega) não gera aviso', async () => {
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: 'Cliente', razao_social: null },
    });

    const r = await aplicarPagamentoNaCobranca(
      sb, { ...COBRANCA, status: 'paga', pago_em: '2026-05-10' }, PAGO, 'webhook',
    );

    expect(r).toMatchObject({ mudou: false, motivo: 'sem_efeito' });
    expect(notificacoes).toHaveLength(0);
  });

  it('quem perde a corrida do compare-and-swap não avisa', async () => {
    // Outro escritor moveu a linha entre a leitura e o UPDATE: anunciar um
    // pagamento que talvez já tenha sido desfeito seria pior que calar.
    const { sb, notificacoes } = fazerClient({
      afetadas: [],
      empresa: { user_id: 'user_cliente', nome: 'Cliente', razao_social: null },
    });

    const r = await aplicarPagamentoNaCobranca(sb, COBRANCA, PAGO, 'reconciliacao');

    expect(r).toMatchObject({ mudou: false, motivo: 'perdeu_corrida' });
    expect(notificacoes).toHaveLength(0);
  });

  it('empresa sem dono (convite não aceito) avisa só o escritório', async () => {
    // `companies.user_id` é nullable: empresa cadastrada pelo contador antes de
    // o cliente aceitar o convite não tem a quem mandar a quitação.
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: null, nome: 'Sem Dono', razao_social: null },
      membros: [{ user_id: 'user_contador' }],
    });

    await aplicarPagamentoNaCobranca(sb, COBRANCA, PAGO, 'webhook');

    const linhas = notificacoes[0].linhas as Record<string, unknown>[];
    expect(linhas).toHaveLength(1);
    expect(linhas[0].owner_user_id).toBe('user_contador');
  });

  it('cobrança avulsa (sem honorário) também avisa', async () => {
    // O `return` antecipado de quem não tem honorário vem DEPOIS do aviso:
    // avulsa também é dinheiro que entrou.
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: 'Cliente', razao_social: null },
      membros: [],
    });

    const r = await aplicarPagamentoNaCobranca(sb, { ...COBRANCA, honorario_id: null }, PAGO, 'webhook');

    expect(r).toMatchObject({ mudou: true, status: 'paga' });
    expect(notificacoes).toHaveLength(1);
  });

  it('sem descrição, o corpo não fica com buraco', async () => {
    const { sb, notificacoes } = fazerClient({
      empresa: { user_id: 'user_cliente', nome: null, razao_social: 'Razão Social LTDA' },
      membros: [{ user_id: 'user_contador' }],
    });

    await aplicarPagamentoNaCobranca(sb, { ...COBRANCA, descricao: '   ' }, PAGO, 'webhook');

    const linhas = notificacoes[0].linhas as Record<string, unknown>[];
    for (const l of linhas) {
      expect(l.corpo).not.toContain('undefined');
      expect(l.corpo).not.toContain('null');
    }
    // Sem `nome`, cai na razão social — nunca em string vazia.
    expect(linhas.find((l) => l.owner_user_id === 'user_contador')!.corpo)
      .toContain('Razão Social LTDA');
  });
});
