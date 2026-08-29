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

type Chamada = {
  tabela: string;
  valores: Record<string, unknown>;
  eq: unknown[][];
  /** Qual client fez a escrita. A 0100 tirou o UPDATE de `notas_fiscais` do
   *  inquilino: escrita que sair pela sessão passa a ser derrubada pela RLS em
   *  produção, e aqui o teste morde antes. */
  cliente: 'sessao' | 'admin';
};

const h = vi.hoisted(() => {
  const inserts: Chamada[] = [];
  const updates: Chamada[] = [];

  const estado = {
    user: { id: 'user-1' } as { id: string } | null,
    companyId: 'empresa-1' as string | null,
    company: {
      // `id`/`user_id` alimentam a guarda `empresaDoDono` — a empresa do
      // `current_company` tem de ser do usuario logado.
      id: 'empresa-1',
      user_id: 'user-1',
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

  function insertInto(tabela: string, valores: Record<string, unknown>, cliente: 'sessao' | 'admin' = 'sessao') {
    const chamada: Chamada = { tabela, valores, eq: [], cliente };
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

  function updateInto(tabela: string, valores: Record<string, unknown>, cliente: 'sessao' | 'admin' = 'sessao') {
    const chamada: Chamada = { tabela, valores, eq: [], cliente };
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

  const fabricarFrom = (cliente: 'sessao' | 'admin') => vi.fn((tabela: string) => ({
    select: (_cols: string) => selectFrom(tabela),
    insert: (valores: Record<string, unknown>) => insertInto(tabela, valores, cliente),
    update: (valores: Record<string, unknown>) => updateInto(tabela, valores, cliente),
  }));

  const from = fabricarFrom('sessao');
  // Mesmo banco falso, client diferente: o que muda é o carimbo em `cliente`,
  // e é ele que prova que a escrita saiu por service role.
  const fromAdmin = fabricarFrom('admin');

  const getUser = vi.fn(async () => ({ data: { user: estado.user } }));
  const supabase = { from, auth: { getUser } };
  const createServerClient = vi.fn(async () => supabase);
  const createAdminClient = vi.fn(() => ({ from: fromAdmin }));

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
    fromAdmin,
    createServerClient,
    createAdminClient,
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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
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

import {
  emitirNotaAction, emitirNfeAction, atualizarStatusNotaAction, cancelarNotaAction,
  lancarNotaManualAction,
} from './actions';
import { MENSAGEM_RECUSA } from '@/lib/fiscal/resolver-credencial';
import { MENSAGEM_NAO_E_DONO } from '@/lib/auth/empresa-dono';

beforeEach(() => {
  h.inserts.length = 0;
  h.updates.length = 0;
  h.estado.user = { id: 'user-1' };
  h.estado.companyId = 'empresa-1';
  h.estado.company = {
    id: 'empresa-1',
    user_id: 'user-1',
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

const inputNotaManual = (over: Record<string, unknown> = {}) => ({
  tipo: 'NFSe' as const,
  clienteId: 'cliente-1',
  numero: '123',
  dataEmissao: '2026-08-29',
  cnae: '6201500',
  codigoTributacao: '010101',
  descricao: 'Servico ja emitido fora do Balu',
  valorReais: 100,
  aliquotaIssPercentual: 5,
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

// ---------------------------------------------------------------------------
// IDOR por `profiles.current_company` (revisao de seguranca, 20/08/2026).
//
// VETOR CONCRETO: `profiles_update` (0010) e so `user_id = auth.uid()` — nao
// valida vinculo nenhum com a empresa. Qualquer usuario faz
// `PATCH /rest/v1/profiles?user_id=eq.<eu>` com
// `{"current_company":"<id de OUTRA empresa>"}` pelo PostgREST. Dai em diante
// `companyId` aponta para empresa alheia, e `tokenParaAmbiente` /
// `resolverCredencialEmissao` rodam com SERVICE ROLE (a 0097 fecha
// `empresa_credenciais_focus` para `authenticated`) — ignoram RLS e devolvem o
// token DECIFRADO daquela empresa. `focus.cancelarNfse(...)` entao cancela
// documento fiscal REAL de outro CNPJ na prefeitura; o update seguinte bate na
// RLS e falha, deixando banco e SEFAZ divergentes.
//
// Quem alcanca de verdade: membro de escritorio aprovado — ele ENXERGA as notas
// dos clientes por `notas_fiscais_select_contador` (0033), entao a leitura da
// nota pelo client de sessao passa para ele. Enxergar nao e poder cancelar: o
// painel do contador e somente visualizacao (aceite do convite + 0033).
//
// Nos mocks: `estado.company.user_id` e o dono da empresa apontada por
// `current_company`. Com ele diferente de `estado.user.id`, a action TEM de
// recusar antes de qualquer chamada a Focus.
describe('0100: toda escrita em notas_fiscais sai por SERVICE ROLE', () => {
  // POR QUE ESTE BLOCO EXISTE
  // A 0100 removeu a policy `notas_fiscais_update`: o inquilino não atualiza
  // mais nota nenhuma pelo PostgREST, porque tudo que se grava numa nota são
  // FATOS DA FOCUS (status, número, chave, protocolo, `pdf_url`, `xml_url`) e
  // o banco não tinha como separar "o servidor gravou o que a Focus
  // respondeu" de um PATCH forjado — as duas chegavam como `authenticated`.
  //
  // A contrapartida é que estas actions PRECISAM escrever por service role.
  // Trocar `escritaDeNota()` de volta por `supabase` passa no `tsc`, passa em
  // todos os outros testes, e só quebra em produção: a RLS derruba o UPDATE,
  // a emissão fica sem o `payload_focusnfe` da resposta e o cancelamento
  // diverge do que está na SEFAZ. Estes testes mordem essa troca.
  const JUSTIFICATIVA = 'Emissao feita por engano, cliente cancelou o pedido.';

  const updatesDeNota = () => h.updates.filter((u) => u.tabela === 'notas_fiscais');

  it('emissão de NFS-e grava a resposta da Focus por service role', async () => {
    await emitirNotaAction(inputNfse());
    const escritas = updatesDeNota();
    expect(escritas.length).toBeGreaterThan(0);
    for (const u of escritas) expect(u.cliente).toBe('admin');
  });

  it('polling de status grava por service role, filtrando pela empresa provada', async () => {
    h.estado.notaExistente = {
      id: 'nota-1', tipo_documento: 'NFSe', referencia: 'ref-nota-1',
      status: 'pendente', origem: 'balu', ambiente: 'hom',
    };
    await atualizarStatusNotaAction('nota-1');
    const escritas = updatesDeNota();
    expect(escritas.length).toBeGreaterThan(0);
    for (const u of escritas) {
      expect(u.cliente).toBe('admin');
      // SEM RLS POR BAIXO: o filtro por empresa é a única barreira que sobra.
      expect(u.eq).toContainEqual(['company_id', 'empresa-1']);
    }
  });

  it('cancelamento grava por service role, filtrando pela empresa provada', async () => {
    h.estado.notaExistente = {
      id: 'nota-1', tipo_documento: 'NFSe', referencia: 'ref-nota-1',
      status: 'ativa', origem: 'balu', ambiente: 'hom',
    };
    await cancelarNotaAction('nota-1', JUSTIFICATIVA);
    const escritas = updatesDeNota();
    expect(escritas.length).toBeGreaterThan(0);
    for (const u of escritas) {
      expect(u.cliente).toBe('admin');
      expect(u.eq).toContainEqual(['company_id', 'empresa-1']);
    }
  });

  it('cancelamento de nota manual também sai por service role', async () => {
    h.estado.notaExistente = {
      id: 'nota-manual-1', tipo_documento: 'NFSe', referencia: 'ref-manual',
      status: 'ativa', origem: 'manual', ambiente: 'hom',
    };
    await cancelarNotaAction('nota-manual-1', JUSTIFICATIVA);
    const escritas = updatesDeNota();
    expect(escritas.length).toBeGreaterThan(0);
    for (const u of escritas) expect(u.cliente).toBe('admin');
  });

  it('o INSERT continua pela SESSÃO — a policy notas_fiscais_insert é a guarda dele', async () => {
    // Mover o insert para service role também não seria erro de compilação, e
    // custaria a única checagem de posse que existe naquele caminho
    // (`user_owns_company` na policy de INSERT, que a 0100 manteve de pé).
    await emitirNotaAction(inputNfse());
    const insert = h.inserts.find((i) => i.tabela === 'notas_fiscais');
    expect(insert?.cliente).toBe('sessao');
  });
});

describe('IDOR: current_company apontando para empresa de outro dono', () => {
  const JUSTIFICATIVA = 'Emissao feita por engano, cliente cancelou o pedido.';
  const empresaAlheia = () => {
    h.estado.company = {
      id: 'empresa-1',
      user_id: 'outro-dono',
      cnpj: '11222333000181',
      codigo_municipio: '3550308',
      razao_social: 'Empresa Do Cliente LTDA',
      municipio: 'Sao Paulo',
      uf: 'SP',
    };
  };

  it('cancelarNotaAction recusa e NAO chama a Focus', async () => {
    empresaAlheia();
    h.estado.notaExistente = {
      id: 'nota-alheia',
      tipo_documento: 'NFSe',
      referencia: 'ref-alheia',
      status: 'ativa',
      origem: 'balu',
      ambiente: 'prod',
    };
    const r = await cancelarNotaAction('nota-alheia', JUSTIFICATIVA);
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.focus.cancelarNfse).not.toHaveBeenCalled();
    expect(h.focus.cancelarNfe).not.toHaveBeenCalled();
    expect(h.focus.cancelarNfce).not.toHaveBeenCalled();
    // O token decifrado nao pode nem ser buscado: quem chama e responsavel por
    // provar o dono ANTES, porque a funcao roda com service role.
    expect(h.tokenParaAmbiente).not.toHaveBeenCalled();
    // E nada pode ter sido gravado na nota alheia.
    expect(h.updates).toHaveLength(0);
  });

  // Nota 'manual' cancela so no banco, sem Focus — mas continua sendo escrita em
  // nota de outra empresa. A guarda tem de vir antes desse ramo tambem.
  it('cancelarNotaAction recusa tambem a nota manual (que so escreve no banco)', async () => {
    empresaAlheia();
    h.estado.notaExistente = {
      id: 'nota-alheia-manual',
      tipo_documento: 'NFSe',
      referencia: 'ref-alheia-manual',
      status: 'ativa',
      origem: 'manual',
      ambiente: 'prod',
    };
    const r = await cancelarNotaAction('nota-alheia-manual', JUSTIFICATIVA);
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.updates).toHaveLength(0);
  });

  it('atualizarStatusNotaAction recusa e NAO chama a Focus', async () => {
    empresaAlheia();
    h.estado.notaExistente = {
      id: 'nota-alheia',
      tipo_documento: 'NFSe',
      referencia: 'ref-alheia',
      payload_focusnfe: { request: {} },
      ambiente: 'prod',
    };
    const r = await atualizarStatusNotaAction('nota-alheia');
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.focus.consultarStatusNfse).not.toHaveBeenCalled();
    expect(h.tokenParaAmbiente).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  // Emissao: mesmo vetor, mesma funcao de service role
  // (`resolverCredencialEmissao`). Hoje o insert seguinte bateria na RLS, mas o
  // token da empresa alheia ja teria sido DECIFRADO em memoria — e a ordem das
  // linhas nao pode ser a unica coisa segurando isso.
  it('emitirNotaAction recusa antes de resolver a credencial', async () => {
    empresaAlheia();
    const r = await emitirNotaAction(inputNfse());
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.resolverCredencialEmissao).not.toHaveBeenCalled();
    expect(h.focus.emitirNfse).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it('emitirNfeAction recusa antes de resolver a credencial', async () => {
    empresaAlheia();
    const r = await emitirNfeAction(inputNfe());
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.resolverCredencialEmissao).not.toHaveBeenCalled();
    expect(h.focus.emitirNfe).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  // Lancamento manual: era a UNICA das seis actions de escrita fiscal sem a
  // guarda (auditoria 29/08/2026) — e a que a auditoria encontrou exposta na
  // tela para o membro de escritorio. Nao chama a Focus, entao aqui nao ha
  // credencial a proteger: o que se protege e o INSERT em empresa alheia e as
  // duas checagens que rodavam com o id NAO PROVADO.
  it('lancarNotaManualAction recusa e NAO insere na empresa alheia', async () => {
    empresaAlheia();
    const r = await lancarNotaManualAction(inputNotaManual());
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    expect(h.inserts).toHaveLength(0);
  });

  // A ORDEM e o ponto: a guarda vem ANTES de `assertAssinaturaEmpresa`. Mover a
  // guarda para depois nao quebra o teste acima (o insert continua barrado),
  // mas volta a responder sobre a assinatura de uma empresa que nao e do
  // usuario. Este teste morde essa mutacao.
  it('lancarNotaManualAction nem consulta a assinatura da empresa alheia', async () => {
    empresaAlheia();
    await lancarNotaManualAction(inputNotaManual());
    expect(h.assertAssinaturaEmpresa).not.toHaveBeenCalled();
  });

  // Mesma mutacao, do outro lado: a checagem de posse do cliente filtra por
  // `company_id`. Com o id NAO PROVADO ela validava contra a empresa errada —
  // deixando de ser barreira e virando decoracao.
  it('lancarNotaManualAction nem chega a validar o cliente da empresa alheia', async () => {
    empresaAlheia();
    h.from.mockClear();
    await lancarNotaManualAction(inputNotaManual());
    const tabelas = h.from.mock.calls.map((c) => c[0]);
    expect(tabelas).not.toContain('clientes');
  });
});
