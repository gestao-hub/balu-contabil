// Bloco 5 — a rede das mutacoes que sobreviveram na revisao final: a decisao
// de ambiente por CREDENCIAL (nao mais fixo 'hom'), a recusa da guarda de
// producao, o carimbo de `ambiente` gravado no INSERT da nota, e a leitura do
// ambiente JA DECIDIDO (`nota.ambiente`) no polling de status e no
// cancelamento — nunca 'hom' fixo ali, porque o ambiente de uma nota ja
// emitida nao se decide de novo.
//
// Cada teste aqui existe para MORDER uma mutacao especifica que hoje passa
// pelo typecheck e por 1971 testes verdes:
//   M1) `const env: FocusEnv = credencial.ambiente` -> `= 'hom'` (NFS-e)
//   M2) idem em `emitirNfeAction`
//   M3) `if (!credencial.ok)` -> `if (false)` — recusa vira sucesso silencioso
//   M4) remover `ambiente: env` do insert da nota
//   M5) polling de status usa 'hom' fixo em vez de `nota.ambiente`
//   M6) cancelamento usa 'hom' fixo em vez de `nota.ambiente`
//
// TUDO MOCKADO NA FRONTEIRA: Supabase (sessao), guards de LGPD/assinatura,
// `resolverCredencialEmissao`/`tokenParaAmbiente`, o cliente Focus, auditoria
// e `next/cache`. Os builders de payload (`buildNfsePayload`/`buildNfePayload`)
// e os helpers puros (notas-tipo, focus-erro, focus-status, nfse-callback,
// municipio-nfse normalize) NAO sao mockados aqui, exceto `resolveMunicipioNfse`
// (le supabase; mockado pra nao precisar reproduzir a query de
// `municipios_nfse` so pra um teste que nao e sobre essa regra).
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][] };

const h = vi.hoisted(() => {
  const inserts: Chamada[] = [];
  const updates: Chamada[] = [];

  const estado = {
    user: { id: 'user-1' } as { id: string } | null,
    companyId: 'empresa-1' as string | null,
    company: {
      cnpj: '11222333000181',
      codigo_municipio: '3550308',
      razao_social: 'Empresa Teste LTDA',
      municipio: 'Sao Paulo',
      uf: 'SP',
    } as Record<string, unknown> | null,
    fiscal: {
      Code_regime_tributario: '1',
      focus_habilita_nfe: true,
      focus_habilita_nfce: true,
    } as Record<string, unknown> | null,
    municipioNfse: { status_nfse: 'ativo' } as Record<string, unknown> | null,
    cliente: {
      id: 'cliente-1',
      razao_social: 'Cliente Pessoa Fisica',
      document: '39053344705',
      person_type: 'PF',
    } as Record<string, unknown> | null,
    companyCnaes: [] as Array<Record<string, unknown>>,
    notaExistente: null as Record<string, unknown> | null,
    insertId: 'nota-nova-1',
    insertError: null as { message: string } | null,
    updateError: null as { message: string } | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credencial: { ok: true, ambiente: 'prod', token: 'tok-prod-1' } as any,
    tokenPorAmbiente: { hom: 'tok-hom-nota', prod: 'tok-prod-nota' } as Record<string, string | null>,
    aceites: { ok: true } as { ok: true } | { ok: false; error: string },
    assinatura: { ok: true } as { ok: true } | { ok: false; error: string },
    municipioSoPortal: null as { possui_cancelamento_nfse?: boolean } | null,
  };

  function selectFrom(tabela: string) {
    function resultado() {
      switch (tabela) {
        case 'profiles':
          return { data: estado.companyId ? { current_company: estado.companyId } : null, error: null };
        case 'companies':
          return { data: estado.company, error: null };
        case 'empresas_fiscais':
          return { data: estado.fiscal, error: null };
        case 'municipios_nfse':
          return { data: estado.municipioNfse, error: null };
        case 'clientes':
          return { data: estado.cliente, error: null };
        case 'company_cnaes':
          return { data: estado.companyCnaes, error: null };
        case 'notas_fiscais':
          return { data: estado.notaExistente, error: null };
        default:
          return { data: null, error: null };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => resultado(),
      maybeSingle: async () => resultado(),
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, falhou),
    };
    return chain;
  }

  function insertInto(tabela: string, valores: Record<string, unknown>) {
    const chamada: Chamada = { tabela, valores, eq: [] };
    inserts.push(chamada);
    return {
      select: (_cols: string) => ({
        single: async () =>
          estado.insertError
            ? { data: null, error: estado.insertError }
            : { data: { id: estado.insertId }, error: null },
      }),
    };
  }

  function updateInto(tabela: string, valores: Record<string, unknown>) {
    const chamada: Chamada = { tabela, valores, eq: [] };
    updates.push(chamada);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      eq: (c: string, v: unknown) => {
        chamada.eq.push([c, v]);
        return chain;
      },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(estado.updateError ? { error: estado.updateError } : { error: null }).then(ok, falhou),
    };
    return chain;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => selectFrom(tabela),
    insert: (valores: Record<string, unknown>) => insertInto(tabela, valores),
    update: (valores: Record<string, unknown>) => updateInto(tabela, valores),
  }));

  const getUser = vi.fn(async () => ({ data: { user: estado.user } }));
  const supabase = { from, auth: { getUser } };
  const createServerClient = vi.fn(async () => supabase);

  // `...args: unknown[]` não são enfeite: sem eles o TS infere aridade zero e
  // `mock.calls[0]` vira `[]` — mesma lição de `focus-actions.test.ts`.
  const focus = {
    emitirNfse: vi.fn(async (..._args: unknown[]) => ({ status: 'processando_autorizacao' })),
    emitirNfe: vi.fn(async (..._args: unknown[]) => ({ status: 'processando_autorizacao' })),
    emitirNfce: vi.fn(async (..._args: unknown[]) => ({ status: 'processando_autorizacao' })),
    consultarStatusNfse: vi.fn(
      async (..._args: unknown[]) => ({ status: 'autorizado', numero: '1', codigo_verificacao: 'abc' }),
    ),
    consultarStatusNfce: vi.fn(async (..._args: unknown[]) => ({ status: 'autorizado' })),
    consultarStatusNfe: vi.fn(async (..._args: unknown[]) => ({ status: 'autorizado' })),
    cancelarNfse: vi.fn(async (..._args: unknown[]) => ({})),
    cancelarNfce: vi.fn(async (..._args: unknown[]) => ({})),
    cancelarNfe: vi.fn(async (..._args: unknown[]) => ({})),
  };
  const generateRef = vi.fn((companyId: string) => `ref-${companyId}`);

  const resolverCredencialEmissao = vi.fn(async (_companyId: string) => estado.credencial);
  const tokenParaAmbiente = vi.fn(
    async (_companyId: string, ambiente: 'hom' | 'prod') => estado.tokenPorAmbiente[ambiente] ?? null,
  );

  const registrarAuditoria = vi.fn(async () => {});
  const revalidatePath = vi.fn(() => {});
  const assertAceitesEmDia = vi.fn(async () => estado.aceites);
  const assertAssinaturaEmpresa = vi.fn(async () => estado.assinatura);
  const resolveMunicipioNfse = vi.fn(async () => estado.municipioSoPortal);

  return {
    inserts,
    updates,
    estado,
    from,
    createServerClient,
    focus,
    generateRef,
    resolverCredencialEmissao,
    tokenParaAmbiente,
    registrarAuditoria,
    revalidatePath,
    assertAceitesEmDia,
    assertAssinaturaEmpresa,
    resolveMunicipioNfse,
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }));
vi.mock('@/lib/lgpd/pendencia-aceite', () => ({ assertAceitesEmDia: h.assertAceitesEmDia }));
vi.mock('@/lib/billing/gate', () => ({ assertAssinaturaEmpresa: h.assertAssinaturaEmpresa }));
vi.mock('@/lib/clients/focus-nfe', () => ({ focus: h.focus, generateRef: h.generateRef }));
vi.mock('@/lib/fiscal/resolver-credencial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fiscal/resolver-credencial')>();
  return {
    ...actual,
    resolverCredencialEmissao: h.resolverCredencialEmissao,
    tokenParaAmbiente: h.tokenParaAmbiente,
  };
});
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/fiscal/municipio-nfse.server', () => ({ resolveMunicipioNfse: h.resolveMunicipioNfse }));

import { emitirNotaAction, emitirNfeAction, atualizarStatusNotaAction, cancelarNotaAction } from './actions';
import { MENSAGEM_RECUSA } from '@/lib/fiscal/resolver-credencial';

beforeEach(() => {
  h.inserts.length = 0;
  h.updates.length = 0;
  h.estado.user = { id: 'user-1' };
  h.estado.companyId = 'empresa-1';
  h.estado.company = {
    cnpj: '11222333000181',
    codigo_municipio: '3550308',
    razao_social: 'Empresa Teste LTDA',
    municipio: 'Sao Paulo',
    uf: 'SP',
  };
  h.estado.fiscal = { Code_regime_tributario: '1', focus_habilita_nfe: true, focus_habilita_nfce: true };
  h.estado.municipioNfse = { status_nfse: 'ativo' };
  h.estado.cliente = {
    id: 'cliente-1',
    razao_social: 'Cliente Pessoa Fisica',
    document: '39053344705',
    person_type: 'PF',
  };
  h.estado.companyCnaes = [];
  h.estado.notaExistente = null;
  h.estado.insertId = 'nota-nova-1';
  h.estado.insertError = null;
  h.estado.updateError = null;
  h.estado.credencial = { ok: true, ambiente: 'prod', token: 'tok-prod-1' };
  h.estado.tokenPorAmbiente = { hom: 'tok-hom-nota', prod: 'tok-prod-nota' };
  h.estado.aceites = { ok: true };
  h.estado.assinatura = { ok: true };
  h.estado.municipioSoPortal = null;
  h.from.mockClear();
  h.createServerClient.mockClear();
  h.generateRef.mockClear();
  h.resolverCredencialEmissao.mockClear();
  h.tokenParaAmbiente.mockClear();
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.assertAceitesEmDia.mockClear();
  h.assertAssinaturaEmpresa.mockClear();
  h.resolveMunicipioNfse.mockClear();
  for (const fn of Object.values(h.focus)) fn.mockClear();
});

const inputNfse = (over: Record<string, unknown> = {}) => ({
  clienteId: 'cliente-1',
  codigoTributacao: '010101',
  descricao: 'Servico de consultoria',
  valorReais: 100,
  aliquotaIssPercentual: 5,
  cnae: '6201500',
  ...over,
});

const inputNfe = (over: Record<string, unknown> = {}) => ({
  clienteId: 'cliente-1',
  naturezaOperacao: 'Venda de mercadoria',
  itens: [
    { descricao: 'Produto X', ncm: '12345678', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 100 },
  ],
  ...over,
});

describe('emitirNotaAction (NFS-e)', () => {
  // M4: remover `ambiente: env` do insert desfaz o carimbo (decisao D4). Se a
  // linha do insert perder o campo, `insert?.valores.ambiente` vira
  // `undefined` e a asserção abaixo cai.
  it('grava o ambiente decidido pela credencial no INSERT da nota', async () => {
    h.estado.credencial = { ok: true, ambiente: 'prod', token: 'tok-prod-1' };
    const r = await emitirNotaAction(inputNfse());
    expect(r.ok).toBe(true);
    const insert = h.inserts.find((i) => i.tabela === 'notas_fiscais');
    expect(insert).toBeDefined();
    expect(insert?.valores.ambiente).toBe('prod');
  });

  // M1: `const env: FocusEnv = credencial.ambiente` trocado por `= 'hom'`
  // passa pelos 1971 testes existentes. Aqui a credencial diz 'prod' — se o
  // env virar fixo, a chamada à Focus e o token usado deixam de bater.
  it('emite na Focus no ambiente decidido pela credencial, nao hom fixo', async () => {
    h.estado.credencial = { ok: true, ambiente: 'prod', token: 'tok-prod-1' };
    await emitirNotaAction(inputNfse());
    expect(h.focus.emitirNfse).toHaveBeenCalledTimes(1);
    const chamada = h.focus.emitirNfse.mock.calls[0]!;
    expect(chamada[2]).toBe('tok-prod-1');
    expect(chamada[3]).toBe('prod');
  });

  // M3: `if (!credencial.ok)` trocado por `if (false)` faz a recusa da
  // guarda virar sucesso silencioso — a nota nasceria mesmo sem credencial.
  it('recusa da credencial vira erro nomeado, e NAO insere nota nenhuma', async () => {
    h.estado.credencial = { ok: false, motivo: 'sem_token_homologacao' };
    const r = await emitirNotaAction(inputNfse());
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.sem_token_homologacao });
    expect(h.inserts).toHaveLength(0);
    expect(h.focus.emitirNfse).not.toHaveBeenCalled();
  });
});

describe('emitirNfeAction (NF-e)', () => {
  // M2: mesma mutacao de M1, agora em emitirNfeAction — nao ha `const env`
  // local aqui, `credencial.ambiente` e usado direto no insert e na chamada
  // Focus; qualquer um dos dois virando 'hom' fixo tem de derrubar o teste.
  it('usa o ambiente decidido pela credencial na Focus e no insert, nao hom fixo', async () => {
    h.estado.credencial = { ok: true, ambiente: 'prod', token: 'tok-prod-nfe' };
    const r = await emitirNfeAction(inputNfe());
    expect(r.ok).toBe(true);
    expect(h.focus.emitirNfe).toHaveBeenCalledTimes(1);
    const chamada = h.focus.emitirNfe.mock.calls[0]!;
    expect(chamada[2]).toBe('tok-prod-nfe');
    expect(chamada[3]).toBe('prod');
    const insert = h.inserts.find((i) => i.tabela === 'notas_fiscais');
    expect(insert?.valores.ambiente).toBe('prod');
  });

  // Mesma recusa de M3, agora do lado da NF-e — a guarda e o mesmo `if
  // (!credencial.ok)` copiado em cada action de emissao.
  it('recusa da credencial vira erro nomeado, e NAO insere nota nenhuma', async () => {
    h.estado.credencial = { ok: false, motivo: 'sem_token_producao' };
    const r = await emitirNfeAction(inputNfe());
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.sem_token_producao });
    expect(h.inserts).toHaveLength(0);
    expect(h.focus.emitirNfe).not.toHaveBeenCalled();
  });
});

describe('atualizarStatusNotaAction — polling le o ambiente CARIMBADO na nota', () => {
  // M5: trocar `ambienteNota` por 'hom' fixo faria o polling consultar a
  // base errada pra toda nota de producao.
  it('consulta o status no ambiente da nota (prod), nao hom fixo', async () => {
    h.estado.notaExistente = {
      id: 'nota-1',
      tipo_documento: 'NFSe',
      referencia: 'ref-nota-1',
      payload_focusnfe: { request: {} },
      ambiente: 'prod',
    };
    const r = await atualizarStatusNotaAction('nota-1');
    expect(r.ok).toBe(true);
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'prod');
    expect(h.focus.consultarStatusNfse).toHaveBeenCalledTimes(1);
    expect(h.focus.consultarStatusNfse.mock.calls[0]![2]).toBe('prod');
  });

  it('nota de homologacao continua consultando homologacao', async () => {
    h.estado.notaExistente = {
      id: 'nota-2',
      tipo_documento: 'NFSe',
      referencia: 'ref-nota-2',
      payload_focusnfe: { request: {} },
      ambiente: 'hom',
    };
    const r = await atualizarStatusNotaAction('nota-2');
    expect(r.ok).toBe(true);
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'hom');
    expect(h.focus.consultarStatusNfse.mock.calls[0]![2]).toBe('hom');
  });
});

describe('cancelarNotaAction — cancelamento le o ambiente CARIMBADO na nota', () => {
  const JUSTIFICATIVA = 'Emissao feita por engano, cliente cancelou o pedido.';

  // M6: trocar `ambienteNota` por 'hom' fixo faria o cancelamento tentar
  // cancelar pela base errada — 404 numa nota que existe em producao.
  it('cancela no ambiente da nota (prod), nao hom fixo', async () => {
    h.estado.notaExistente = {
      id: 'nota-1',
      tipo_documento: 'NFSe',
      referencia: 'ref-nota-1',
      status: 'ativa',
      origem: 'balu',
      ambiente: 'prod',
    };
    const r = await cancelarNotaAction('nota-1', JUSTIFICATIVA);
    expect(r).toEqual({ ok: true });
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'prod');
    expect(h.focus.cancelarNfse).toHaveBeenCalledTimes(1);
    expect(h.focus.cancelarNfse.mock.calls[0]![3]).toBe('prod');
  });

  it('nota de homologacao continua cancelando em homologacao', async () => {
    h.estado.notaExistente = {
      id: 'nota-2',
      tipo_documento: 'NFSe',
      referencia: 'ref-nota-2',
      status: 'ativa',
      origem: 'balu',
      ambiente: 'hom',
    };
    const r = await cancelarNotaAction('nota-2', JUSTIFICATIVA);
    expect(r).toEqual({ ok: true });
    expect(h.tokenParaAmbiente).toHaveBeenCalledWith('empresa-1', 'hom');
    expect(h.focus.cancelarNfse.mock.calls[0]![3]).toBe('hom');
  });
});
