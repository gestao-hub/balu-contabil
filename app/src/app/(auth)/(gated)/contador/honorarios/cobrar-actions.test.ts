// Bloco 4B — invariantes de `cobrarHonorarioAction`.
//
// POR QUE ESTE ARQUIVO EXISTE
// A mensalidade e o principal que um escritorio cobra, e este e o unico caminho
// que a transforma em cobranca. O que ele decide sozinho — qual honorario, por
// quanto, com que vencimento, e QUAL das tres colunas liga honorario e cobranca
// — nao e verificavel por `tsc`.
//
// Cada teste morde uma mudanca que hoje passaria pelo `tsc --noEmit`:
//   1. emitir duas vezes o mesmo honorario;
//   2. emitir honorario de OUTRO escritorio;
//   3. converter `numeric(14,2)` por float e perder um centavo;
//   4. deixar de passar `honorarioId` ao motor (a ligacao canonica) — e o
//      semaforo do painel nunca mais fecharia sozinho;
//   5. tirar o compare-and-swap do back-pointer, ou deixar o perdedor da
//      corrida sair em silencio;
//   6. preencher `pagamento_origem` na EMISSAO (ele descreve o PAGAMENTO).
//
// O motor de emissao (`@/lib/billing/emitir-cobranca`) e mockado inteiro: ele
// tem a sua propria rede em `src/lib/billing/emitir-cobranca.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user_teste_1';
const HONORARIO_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

const CLIENTE = { id: COMPANY_ID, nome: 'Padaria do Ze LTDA', cpfCnpj: '12345678000195', email: null };

type Consulta = { tabela: string; eq: unknown[][] };
type Atualizacao = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; is: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const auditorias: Array<{ acao: string } & Record<string, unknown>> = [];
  const consultas: Array<{ tabela: string; eq: unknown[][] }> = [];
  const atualizacoes: Array<{ tabela: string; valores: Record<string, unknown>; eq: unknown[][]; is: unknown[][]; select: string[] }> = [];

  const estado = {
    guard: null as unknown,
    honorario: null as Record<string, unknown> | null,
    cliente: null as unknown,
    emissao: null as unknown,
    /** O que o `.select('id')` do back-pointer devolve: 1 linha = venceu. */
    linhasLigadas: [{ id: '33333333-3333-4333-8333-333333333333' }] as { id: string }[],
    erroUpdate: null as { message: string } | null,
  };

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const c = { tabela, eq: [] as unknown[][] };
      consultas.push(c);
      const b = {
        eq: (col: unknown, v: unknown) => { c.eq.push([col, v]); return b; },
        maybeSingle: async () => ({ data: estado.honorario, error: null }),
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => {
      const u = { tabela, valores, eq: [] as unknown[][], is: [] as unknown[][], select: [] as string[] };
      atualizacoes.push(u);
      const resultado = () => {
        if (estado.erroUpdate) return { data: null, error: estado.erroUpdate };
        // FIEL AO supabase-js: sem `.select()`, `data` volta null — e o
        // perdedor da corrida vira indistinguivel do vencedor.
        return u.select.length === 0 ? { data: null, error: null } : { data: estado.linhasLigadas, error: null };
      };
      const b = {
        eq: (col: unknown, v: unknown) => { u.eq.push([col, v]); return b; },
        is: (col: unknown, v: unknown) => { u.is.push([col, v]); return b; },
        select: (cols: string) => { u.select.push(cols); return b; },
        then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, falhou),
      };
      return b;
    },
  }));

  const emitirCobrancaEscritorio = vi.fn(async (_sb: unknown, _p: unknown) => estado.emissao);
  const clienteDaCarteira = vi.fn(async () => estado.cliente);
  const registrarAuditoria = vi.fn(async (e: { acao: string } & Record<string, unknown>) => { auditorias.push(e); });
  const revalidatePath = vi.fn();

  return { auditorias, consultas, atualizacoes, estado, from, emitirCobrancaEscritorio, clienteDaCarteira, registrarAuditoria, revalidatePath };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/billing/emitir-cobranca', () => ({
  emitirCobrancaEscritorio: h.emitirCobrancaEscritorio,
  clienteDaCarteira: h.clienteDaCarteira,
}));

import { cobrarHonorarioAction } from './cobrar-actions';

const consultasDe = (t: string): Consulta[] => h.consultas.filter((c) => c.tabela === t);
const updatesDe = (t: string): Atualizacao[] => h.atualizacoes.filter((u) => u.tabela === t);
/** O pedido que chegou ao motor de emissao. */
const pedidoEmitido = () => h.emitirCobrancaEscritorio.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

let logs: string[] = [];

beforeEach(() => {
  h.auditorias.length = 0;
  h.consultas.length = 0;
  h.atualizacoes.length = 0;
  vi.clearAllMocks();

  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.honorario = {
    id: HONORARIO_ID,
    empresa_cliente_id: COMPANY_ID,
    mes_referencia: '2026-07-01',
    valor: '199.90',
    data_vencimento: '2099-12-10',
    status: 'pendente',
    cobranca_escritorio_id: null,
  };
  h.estado.cliente = CLIENTE;
  h.estado.emissao = { ok: true, cobrancaId: 'cob_0001', chargeId: 'pay_0001', linkFatura: 'https://asaas.invalid/i/1' };
  h.estado.linhasLigadas = [{ id: HONORARIO_ID }];
  h.estado.erroUpdate = null;

  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
});

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// 1. O CAMINHO FELIZ E O QUE ELE MANDA AO MOTOR
// ---------------------------------------------------------------------------
describe('cobrarHonorarioAction — emissao', () => {
  it('emite com valor, vencimento, competencia e a LIGACAO CANONICA', async () => {
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toEqual({ ok: true, linkFatura: 'https://asaas.invalid/i/1' });

    expect(pedidoEmitido()).toMatchObject({
      contabilidadeId: CONTABILIDADE_ID,
      userId: USER_ID,
      cliente: CLIENTE,
      // `numeric(14,2)` chega como STRING: converter por float perderia o
      // centavo (199.9 * 100 = 19989.999...).
      valorCentavos: 19990,
      vencimento: '2099-12-10',
      descricao: 'Honorários contábeis — 07/2026',
      servicoAvulsoId: null,
      // SEM ISTO o webhook nunca saberia qual honorario marcar como pago.
      honorarioId: HONORARIO_ID,
    });
  });

  it('competencia no formato legado (YYYYMM) tambem vira MM/YYYY', async () => {
    h.estado.honorario = { ...h.estado.honorario, mes_referencia: '202607' };
    await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(pedidoEmitido()).toMatchObject({ descricao: 'Honorários contábeis — 07/2026' });
  });

  it('erro do motor volta como erro da action, sem tocar no honorario', async () => {
    h.estado.emissao = { ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toEqual({ ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' });
    expect(updatesDe('honorarios')).toHaveLength(0);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. ISOLAMENTO E RECUSAS
// ---------------------------------------------------------------------------
describe('cobrarHonorarioAction — isolamento e recusas', () => {
  it('le o honorario escopado por id E por contabilidade (anti-IDOR)', async () => {
    await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    const c = consultasDe('honorarios')[0];
    expect(c.eq).toContainEqual(['id', HONORARIO_ID]);
    expect(c.eq).toContainEqual(['contabilidade_id', CONTABILIDADE_ID]);
  });

  it('honorario de outro escritorio nao emite', async () => {
    h.estado.honorario = null;
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toEqual({ ok: false, error: 'Honorário não encontrado neste escritório.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('cliente fora da carteira nao emite', async () => {
    h.estado.cliente = null;
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: false });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('honorario que JA tem cobranca nao emite outra (duplo clique sequencial)', async () => {
    h.estado.honorario = { ...h.estado.honorario, cobranca_escritorio_id: 'cob_antiga' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toEqual({ ok: false, error: 'Este honorário já tem uma cobrança emitida.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('honorario ja pago nao emite', async () => {
    h.estado.honorario = { ...h.estado.honorario, status: 'pago' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: false });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('linha legada sem empresa_cliente_id nao emite', async () => {
    h.estado.honorario = { ...h.estado.honorario, empresa_cliente_id: null };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: false });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it.each([null, '0', '0.00'])('valor %s nao vira cobranca', async (valor) => {
    h.estado.honorario = { ...h.estado.honorario, valor };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: false });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('id que nao e uuid nem chega ao banco', async () => {
    const r = await cobrarHonorarioAction({ honorarioId: 'nao-e-uuid' });
    expect(r).toEqual({ ok: false, error: 'Honorário inválido.' });
    expect(h.consultas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. VENCIMENTO — o Asaas recusa data no passado
// ---------------------------------------------------------------------------
describe('cobrarHonorarioAction — vencimento', () => {
  it('vencimento vencido pede data nova em portugues, em vez de erro do Asaas', async () => {
    h.estado.honorario = { ...h.estado.honorario, data_vencimento: '2020-01-10' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toEqual({
      ok: false,
      error: 'O vencimento deste honorário já passou — informe uma nova data para a cobrança.',
    });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('data informada substitui a do honorario', async () => {
    h.estado.honorario = { ...h.estado.honorario, data_vencimento: '2020-01-10' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID, vencimento: '2099-11-05' });
    expect(r).toMatchObject({ ok: true });
    expect(pedidoEmitido()).toMatchObject({ vencimento: '2099-11-05' });
  });

  it('honorario sem vencimento e sem data informada nao emite', async () => {
    h.estado.honorario = { ...h.estado.honorario, data_vencimento: null };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: false });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. O BACK-POINTER (a ligacao DERIVADA)
// ---------------------------------------------------------------------------
describe('cobrarHonorarioAction — back-pointer', () => {
  it('grava cobranca_escritorio_id com compare-and-swap escopado', async () => {
    await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    const [u] = updatesDe('honorarios');
    expect(u.valores).toMatchObject({ cobranca_escritorio_id: 'cob_0001' });
    expect(u.eq).toContainEqual(['id', HONORARIO_ID]);
    expect(u.eq).toContainEqual(['contabilidade_id', CONTABILIDADE_ID]);
    // Sem o `.is`, dois cliques simultaneos ligariam os dois e o segundo
    // apagaria o rastro do primeiro.
    expect(u.is).toContainEqual(['cobranca_escritorio_id', null]);
    // Sem o `.select`, o perdedor da corrida seria indistinguivel do vencedor.
    expect(u.select).toContain('id');
  });

  it('a emissao NAO mexe em pagamento_origem nem nos ganchos mortos da 0032', async () => {
    await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    const [u] = updatesDe('honorarios');
    // `pagamento_origem` descreve a ORIGEM DO PAGAMENTO; aqui ainda nao houve
    // pagamento nenhum. Quem o marca 'asaas' e o webhook.
    expect(u.valores).not.toHaveProperty('pagamento_origem');
    expect(u.valores).not.toHaveProperty('status');
    expect(u.valores).not.toHaveProperty('data_pagamento');
    // A ligacao canonica e `cobrancas_escritorio.honorario_id`; estas duas
    // colunas ficam mortas de proposito, e nao meio preenchidas.
    expect(u.valores).not.toHaveProperty('asaas_charge_id');
    expect(u.valores).not.toHaveProperty('asaas_customer_id');
  });

  it('perdedor da corrida: a cobranca vale, mas o contador e AVISADO e fica em auditoria', async () => {
    h.estado.linhasLigadas = [];
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    // A cobranca existe no Asaas e ja foi gravada com `honorario_id` — dizer
    // "falhou" seria mentira, e o boleto continuaria de pe.
    expect(r).toMatchObject({ ok: true, aviso: expect.stringContaining('Confira no Asaas') });
    expect(h.auditorias.map((a) => a.acao)).toContain('cobranca_escritorio.honorario_duplicado');
  });

  // "Ja havia outra cobranca" e "nao consegui gravar" pedem investigacoes
  // opostas: a primeira e uma corrida, a segunda e o banco recusando escrita.
  // Um registro so nao distinguiria as duas.
  it('falha de gravacao do back-pointer tem acao propria e avisa para NAO repetir', async () => {
    h.estado.erroUpdate = { message: 'permission denied for table honorarios' };
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).toMatchObject({ ok: true, aviso: expect.stringContaining('não clique de novo') });
    expect(h.auditorias.map((a) => a.acao)).toEqual(['cobranca_escritorio.honorario_sem_vinculo']);
  });

  it('sem corrida, nao ha aviso nem auditoria de duplicidade', async () => {
    const r = await cobrarHonorarioAction({ honorarioId: HONORARIO_ID });
    expect(r).not.toHaveProperty('aviso');
    expect(h.auditorias).toHaveLength(0);
    expect(h.revalidatePath).toHaveBeenCalledWith('/contador/honorarios');
  });
});
