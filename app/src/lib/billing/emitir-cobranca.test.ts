// Bloco 4B — a rede das invariantes de `emitirCobrancaEscritorio`.
//
// POR QUE ESTE ARQUIVO EXISTE
// Esta e a unica porta pela qual dinheiro de TERCEIRO e cobrado por este
// sistema. O principio do bloco — "a Balu nao intermedia dinheiro de terceiro,
// a cobranca nasce NA SUBCONTA" — nao e verificavel por `tsc`: trocar
// `asaasSub(token)` por `asaas` compila, passa no lint, e so aparece meses
// depois, quando alguem consulta a cobranca pela conta-mae e ela esta la.
//
// Cada teste aqui existe para MORDER uma mudanca especifica que hoje passaria
// por `tsc --noEmit` e pelo resto da suite:
//   1. emitir pela conta-mae em vez da subconta;
//   2. tirar o gate de inadimplencia da porta de criacao;
//   3. emitir com KYC nao aprovado;
//   4. ler a credencial FORA do try (a excecao escapa como erro generico);
//   5. deixar a chave cair em log, auditoria ou retorno;
//   6. tirar o `.eq('id', contabilidade)` da leitura da credencial;
//   7. deixar uma cobranca emitida e nao gravada sair em silencio;
//   8. criar um cadastro de cliente novo a cada emissao;
//   9. arbitrar a idempotencia DEPOIS da chamada ao Asaas — o que faz nascer o
//      segundo boleto e deixa-lo orfao (ver a secao 9, e o bloco IDEMPOTENCIA
//      do modulo);
//  10. devolver o trinco depois de um erro AMBIGUO do Asaas, transformando o
//      proximo clique num segundo boleto certo;
//  11. deixar um 23505 chegar cru a tela do contador.
//
// TUDO MOCKADO NA FRONTEIRA: Asaas, gate e auditoria. O Supabase e um fake
// passado por parametro. A cifra (`credencial-subconta`) e a de VERDADE, com uma
// CERT_ENC_KEY de teste — e o unico jeito de provar que o token que chega ao
// Asaas saiu da coluna cifrada, e nao de um atalho.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarCredencial } from './credencial-subconta';

// Valor obviamente falso: nenhuma chave real deve existir num fixture.
const CHAVE_FALSA = '$aact_TESTE_chave_obviamente_falsa_nunca_use_1234';
const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const OUTRA_CONTABILIDADE = '99999999-9999-4999-8999-999999999999';
const USER_ID = 'user_teste_1';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

const CLIENTE = {
  id: COMPANY_ID,
  nome: 'Padaria do Ze LTDA',
  cpfCnpj: '12.345.678/0001-95',
  email: 'ze@padaria.invalid',
};

const h = vi.hoisted(() => {
  const ordem: string[] = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> } & Record<string, unknown>> = [];
  const tokensDaSubconta: string[] = [];

  const estado = {
    gate: { ok: true } as { ok: true } | { ok: false; error: string },
    clientesNoAsaas: [] as Array<{ id: string; name: string; cpfCnpj: string }>,
    erroBusca: null as unknown,
    cobranca: { id: 'pay_0001', invoiceUrl: 'https://asaas.invalid/i/pay_0001' } as unknown,
    erroCobranca: null as unknown,
  };

  const criarCliente = vi.fn(async (_d: unknown) => {
    ordem.push('sub.criarCliente');
    return { id: 'cus_novo', name: 'x', cpfCnpj: '12345678000195' };
  });
  const buscarClientesPorDocumento = vi.fn(async (_doc: string) => {
    ordem.push('sub.buscarClientes');
    if (estado.erroBusca) throw estado.erroBusca;
    return { data: estado.clientesNoAsaas };
  });
  const criarCobranca = vi.fn(async (_d: unknown) => {
    ordem.push('sub.criarCobranca');
    if (estado.erroCobranca) throw estado.erroCobranca;
    return estado.cobranca;
  });

  const asaasSub = vi.fn((token: string) => {
    tokensDaSubconta.push(token);
    return { criarCliente, buscarClientesPorDocumento, criarCobranca };
  });

  // A conta-mae inteira e uma armadilha: qualquer chamada aqui e o bloco
  // perdendo o sentido. Nenhum teste a autoriza.
  const contaMae = {
    criarCliente: vi.fn(() => { ordem.push('CONTA_MAE.criarCliente'); throw new Error('conta-mae usada'); }),
    criarCobranca: vi.fn(() => { ordem.push('CONTA_MAE.criarCobranca'); throw new Error('conta-mae usada'); }),
  };

  const registrarAuditoria = vi.fn(async (e: { acao: string } & Record<string, unknown>) => {
    ordem.push(`audit:${e.acao}`);
    auditorias.push(e);
  });

  const assertAssinaturaEscritorio = vi.fn(async (_id: string) => {
    ordem.push('gate');
    return estado.gate;
  });

  return {
    ordem, auditorias, tokensDaSubconta, estado,
    asaasSub, contaMae, criarCliente, buscarClientesPorDocumento, criarCobranca,
    registrarAuditoria, assertAssinaturaEscritorio,
  };
});

vi.mock('@/lib/clients/asaas', () => ({ asaasSub: h.asaasSub, asaas: h.contaMae, asaasContaMae: h.contaMae }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/billing/gate', () => ({ assertAssinaturaEscritorio: h.assertAssinaturaEscritorio }));

import { emitirCobrancaEscritorio, clienteDaCarteira, type PedidoEmissao } from './emitir-cobranca';

// ---------------------------------------------------------------------------
// Fake do Supabase — registra COMO cada tabela foi filtrada, porque o filtro
// por contabilidade e a unica coisa que separa o dinheiro de dois escritorios.
// ---------------------------------------------------------------------------
type Insercao = { tabela: string; valores: Record<string, unknown> };
type Consulta = { tabela: string; eq: unknown[][] };

type ChamadaRpc = { fn: string; args: Record<string, unknown> };

const db = {
  consultas: [] as Consulta[],
  insercoes: [] as Insercao[],
  rpcs: [] as ChamadaRpc[],
  contabilidade: null as Record<string, unknown> | null,
  erroContabilidade: null as { message: string } | null,
  company: null as Record<string, unknown> | null,
  linhaInserida: { id: 'cob_0001' } as { id: string } | null,
  erroInsert: null as { message: string; code?: string } | null,
  /** O que a pre-checagem encontra em `cobrancas_escritorio`. */
  cobrancasExistentes: [] as Array<{ status: string; link_fatura: string | null }>,
  erroLista: null as { message: string } | null,
  /** `null` = a RPC devolveu NULL = PERDEU a corrida do trinco. */
  donoReserva: 'd0d0d0d0-1111-4111-8111-111111111111' as string | null,
  erroReservar: null as { message: string } | null,
  erroLiberar: null as { message: string } | null,
  /** O que mudou no banco ENTRE a pre-checagem e o INSERT. E a unica maneira
   *  honesta de encenar um 23505: se a linha ja existisse antes, a pre-checagem
   *  teria barrado e o Asaas nunca teria sido chamado. */
  aoInserir: null as (() => void) | null,
};

function fakeSb(): SupabaseClient {
  return {
    // A RPC do trinco (0055). Fica no `ordem` junto com as chamadas do Asaas
    // porque a invariante que mais importa deste modulo e a ORDEM entre as duas:
    // reservar DEPOIS de falar com o Asaas e o que produz o boleto orfao.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.ordem.push(`rpc:${fn}`);
      db.rpcs.push({ fn, args });
      if (fn === 'reservar_emissao_cobranca') {
        return db.erroReservar
          ? { data: null, error: db.erroReservar }
          : { data: db.donoReserva, error: null };
      }
      if (fn === 'liberar_reserva_cobranca') {
        return db.erroLiberar ? { data: null, error: db.erroLiberar } : { data: 1, error: null };
      }
      throw new Error(`RPC inesperada no fake: ${fn}`);
    },
    from(tabela: string) {
      return {
        select: (_cols: string) => {
          const c: Consulta = { tabela, eq: [] };
          db.consultas.push(c);
          const b = {
            eq: (col: unknown, v: unknown) => { c.eq.push([col, v]); return b; },
            maybeSingle: async () =>
              tabela === 'contabilidades'
                ? { data: db.contabilidade, error: db.erroContabilidade }
                : { data: db.company, error: null },
            // FIEL AO supabase-js: o proprio builder e um thenable, e awaita-lo
            // sem `.maybeSingle()` devolve a LISTA. E assim que a pre-checagem
            // pergunta "ja existe cobranca para este alvo?".
            then: (
              res: (v: { data: unknown; error: unknown }) => unknown,
              rej: (e: unknown) => unknown,
            ) => Promise.resolve({
              data: db.erroLista ? null : db.cobrancasExistentes,
              error: db.erroLista,
            }).then(res, rej),
          };
          return b;
        },
        insert: (valores: Record<string, unknown>) => {
          db.insercoes.push({ tabela, valores });
          db.aoInserir?.();
          return {
            select: (_c: string) => ({
              maybeSingle: async () => ({
                data: db.erroInsert ? null : db.linhaInserida,
                error: db.erroInsert,
              }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const pedido = (over: Partial<PedidoEmissao> = {}): PedidoEmissao => ({
  contabilidadeId: CONTABILIDADE_ID,
  userId: USER_ID,
  cliente: CLIENTE,
  descricao: 'Abertura de empresa',
  valorCentavos: 90000,
  vencimento: '2026-08-10',
  servicoAvulsoId: null,
  honorarioId: null,
  // O default e o caminho SEM chave nenhuma — o do avulso de hoje, cuja tela
  // ainda nao existe (Task 10). Ele nao toma trinco: e o unico caminho sem
  // trava, e a secao 9 prova que ele continua assim de proposito.
  idempotencyKey: null,
  ...over,
});

let logs: string[] = [];

beforeAll(() => {
  // Mesma convencao de credencial-subconta.test.ts: chave fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.ordem.length = 0;
  h.auditorias.length = 0;
  h.tokensDaSubconta.length = 0;
  h.estado.gate = { ok: true };
  h.estado.clientesNoAsaas = [];
  h.estado.erroBusca = null;
  h.estado.cobranca = { id: 'pay_0001', invoiceUrl: 'https://asaas.invalid/i/pay_0001' };
  h.estado.erroCobranca = null;
  vi.clearAllMocks();

  db.consultas = [];
  db.insercoes = [];
  db.rpcs = [];
  db.cobrancasExistentes = [];
  db.erroLista = null;
  db.donoReserva = 'd0d0d0d0-1111-4111-8111-111111111111';
  db.erroReservar = null;
  db.erroLiberar = null;
  db.aoInserir = null;
  db.contabilidade = {
    id: CONTABILIDADE_ID,
    asaas_subconta_status: 'aprovada',
    asaas_api_key_cifrada: guardarCredencial(CHAVE_FALSA),
  };
  db.erroContabilidade = null;
  db.company = null;
  db.linhaInserida = { id: 'cob_0001' };
  db.erroInsert = null;

  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
});

afterEach(() => { vi.restoreAllMocks(); });

/** Tudo que o servidor "falou" sobre esta execucao: log + auditoria + retorno. */
const textoObservado = (retorno: unknown) => JSON.stringify({ logs, auditorias: h.auditorias, retorno });

// ---------------------------------------------------------------------------
// 1. A COBRANCA NASCE NA SUBCONTA — o principio do bloco
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — nasce na subconta', () => {
  it('usa asaasSub com o token DECIFRADO da coluna, e nunca a conta-mae', async () => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toMatchObject({ ok: true, chargeId: 'pay_0001' });

    // O token que chegou ao cliente do Asaas e exatamente o que estava cifrado
    // na coluna: nao ha atalho lendo a chave de outro lugar.
    expect(h.tokensDaSubconta).toEqual([CHAVE_FALSA]);
    expect(h.criarCobranca).toHaveBeenCalledTimes(1);
    expect(h.contaMae.criarCobranca).not.toHaveBeenCalled();
    expect(h.contaMae.criarCliente).not.toHaveBeenCalled();
    expect(h.ordem.some((o) => o.startsWith('CONTA_MAE'))).toBe(false);
  });

  it('manda ao Asaas valor em reais, vencimento e a referencia escritorio:cliente', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ valorCentavos: 12345 }));
    expect(h.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({
      billingType: 'UNDEFINED',
      value: 123.45,
      dueDate: '2026-08-10',
      description: 'Abertura de empresa',
      externalReference: `${CONTABILIDADE_ID}:${COMPANY_ID}`,
    }));
  });
});

// ---------------------------------------------------------------------------
// 2. O GATE BLOQUEIA SO CRIAR
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — gate de inadimplencia', () => {
  it('escritorio devendo a Balu NAO emite, e nada e chamado no Asaas', async () => {
    h.estado.gate = { ok: false, error: 'Assinatura pendente.' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toEqual({ ok: false, error: 'Assinatura pendente.' });
    expect(h.asaasSub).not.toHaveBeenCalled();
    expect(db.insercoes).toHaveLength(0);
  });

  it('o gate e a PRIMEIRA coisa: nem a credencial e lida antes dele', async () => {
    h.estado.gate = { ok: false, error: 'Assinatura pendente.' };
    await emitirCobrancaEscritorio(fakeSb(), pedido());
    // Nenhuma leitura de `contabilidades` — a chave nem sai do banco.
    expect(db.consultas).toHaveLength(0);
    expect(h.ordem[0]).toBe('gate');
  });
});

// ---------------------------------------------------------------------------
// 3. KYC E CREDENCIAL
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — KYC e credencial', () => {
  it.each(['ausente', 'pendente', 'recusada'])('subconta %s nao emite', async (status) => {
    db.contabilidade = { ...db.contabilidade, asaas_subconta_status: status };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toEqual({ ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' });
    expect(h.asaasSub).not.toHaveBeenCalled();
  });

  // `lerCredencial` LANCA quando falta o prefixo `enc:v1:`. Se a leitura sair de
  // dentro do try, a excecao escapa da Server Action como erro generico do Next
  // — e este ramo, com a frase que manda falar com o suporte, fica inalcancavel.
  it('credencial gravada EM CLARO vira erro amigavel, nunca excecao', async () => {
    db.contabilidade = { ...db.contabilidade, asaas_api_key_cifrada: CHAVE_FALSA };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toEqual({
      ok: false,
      error: 'A credencial da conta de recebimento está ilegível. Fale com o suporte da Balu.',
    });
    // E nem mesmo aqui a chave em claro entra no log.
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
  });

  it('credencial ausente vira erro amigavel', async () => {
    db.contabilidade = { ...db.contabilidade, asaas_api_key_cifrada: null };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toMatchObject({ ok: false });
    expect(h.asaasSub).not.toHaveBeenCalled();
  });

  // O admin client ignora RLS: sem este `.eq`, um bug de escopo leria a chave
  // de qualquer escritorio — e emitiria na subconta de outra pessoa.
  it('le a credencial SEMPRE escopada pelo id do contexto', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ contabilidadeId: OUTRA_CONTABILIDADE }));
    const c = db.consultas.find((q) => q.tabela === 'contabilidades');
    expect(c?.eq).toContainEqual(['id', OUTRA_CONTABILIDADE]);
  });
});

// ---------------------------------------------------------------------------
// 4. A CHAVE NAO VAZA
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — a chave nao vaza', () => {
  it('sucesso: nem no retorno, nem na auditoria, nem no log', async () => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
    // Nem mascarada: aqui nao ha o caso da criacao, em que o id da subconta
    // precisa ser rastreado.
    expect(textoObservado(r)).not.toContain('$aact');
  });

  it('erro do Asaas: a mensagem do fornecedor NAO chega a tela NEM AO LOG', async () => {
    // Erro de rede carregando o header — o pior caso realista.
    h.estado.erroCobranca = new Error(`fetch failed: access_token=${CHAVE_FALSA}`);
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r).toEqual({
      ok: false,
      error: 'Não foi possível emitir a cobrança agora. Tente de novo em instantes.',
    });
    // `textoObservado`, e nao `JSON.stringify(r)`: este cenario monta o pior
    // caso justamente para o LOG — a mensagem do Asaas nunca chegou ao retorno,
    // que e uma constante. Olhar so o retorno era anunciar a invariante sem
    // checa-la, e `mensagemCurta` truncava sem redigir.
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
    expect(textoObservado(r)).not.toContain('$aact');
    // A mensagem redigida continua util: da para saber O QUE falhou.
    expect(logs.join(' ')).toContain('fetch failed');
  });

  // Mesma funcao (`mensagemCurta`), segundo call site: a busca de cliente e
  // best-effort e loga o erro antes de cair em criar.
  it('erro da BUSCA de cliente tambem sai redigido do log', async () => {
    h.estado.erroBusca = new Error(`getaddrinfo ENOTFOUND (access_token=${CHAVE_FALSA})`);
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r.ok).toBe(true);
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
    expect(textoObservado(r)).not.toContain('$aact');
  });

  // A chave solta, sem o nome do header na frente: truncar em 200 chars deixa
  // passar (a mensagem inteira cabe), redigir nao.
  it('chave SOLTA numa mensagem curta tambem e redigida', async () => {
    h.estado.erroCobranca = new Error(`ECONNRESET ${CHAVE_FALSA}`);
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
    expect(textoObservado(r)).not.toContain('$aact');
  });

  it('a insercao no banco nao carrega a chave', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(JSON.stringify(db.insercoes)).not.toContain(CHAVE_FALSA);
  });
});

// ---------------------------------------------------------------------------
// 5. PERSISTENCIA
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — persistencia', () => {
  it('grava em cobrancas_escritorio (NUNCA em cobrancas, que e o dinheiro da Balu)', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: 'hon_1' }));
    expect(db.insercoes.map((i) => i.tabela)).toEqual(['cobrancas_escritorio']);
    expect(db.insercoes[0].valores).toMatchObject({
      contabilidade_id: CONTABILIDADE_ID,
      empresa_cliente_id: COMPANY_ID,
      honorario_id: 'hon_1',
      servico_avulso_id: null,
      asaas_charge_id: 'pay_0001',
      status: 'pendente',
      valor_centavos: 90000,
      vencimento: '2026-08-10',
      link_fatura: 'https://asaas.invalid/i/pay_0001',
    });
  });

  it('a auditoria de sucesso liga cobranca, charge e origem', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ servicoAvulsoId: 'srv_1' }));
    const a = h.auditorias.find((x) => x.acao === 'cobranca_escritorio.emitida');
    expect(a?.meta).toMatchObject({ cobranca_id: 'cob_0001', charge_id: 'pay_0001', servico_avulso_id: 'srv_1' });
    expect(a?.contabilidadeId).toBe(CONTABILIDADE_ID);
  });

  // O pior estado possivel: existe um boleto na mao do cliente que o painel do
  // escritorio nao conhece e o webhook vai descartar como desconhecido.
  it('cobranca emitida e NAO gravada vira auditoria propria e erro que manda conferir', async () => {
    db.erroInsert = { message: 'permission denied for table cobrancas_escritorio' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining('Confira no Asaas') });
    const a = h.auditorias.find((x) => x.acao === 'cobranca_escritorio.nao_gravada');
    expect(a?.meta).toMatchObject({ charge_id: 'pay_0001' });
  });

  it('Asaas sem id de cobranca nao vira linha no banco', async () => {
    h.estado.cobranca = { invoiceUrl: 'x' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r.ok).toBe(false);
    expect(db.insercoes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. RECUSAS QUE NAO CHEGAM A GASTAR UMA CHAMADA NO ASAAS
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — recusas locais', () => {
  it.each([
    ['valor zero', { valorCentavos: 0 }],
    ['valor negativo', { valorCentavos: -1 }],
    ['descricao vazia', { descricao: '   ' }],
    ['cliente sem documento', { cliente: { ...CLIENTE, cpfCnpj: '' } }],
    ['documento truncado', { cliente: { ...CLIENTE, cpfCnpj: '123' } }],
  ])('%s recusa antes do Asaas', async (_nome, over) => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido(over as Partial<PedidoEmissao>));
    expect(r.ok).toBe(false);
    expect(h.criarCobranca).not.toHaveBeenCalled();
    expect(db.insercoes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. CADASTRO DO CLIENTE NA SUBCONTA — a agenda e do ESCRITORIO
// ---------------------------------------------------------------------------
describe('emitirCobrancaEscritorio — cliente na subconta', () => {
  it('reusa o cadastro existente quando o documento bate', async () => {
    h.estado.clientesNoAsaas = [{ id: 'cus_ja_existe', name: 'Padaria', cpfCnpj: '12345678000195' }];
    await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(h.criarCliente).not.toHaveBeenCalled();
    expect(h.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_ja_existe' }));
  });

  // Se um dia o filtro do Asaas mudar de nome e a rota devolver "os primeiros
  // clientes", reusar o primeiro da lista seria cobrar a pessoa errada.
  it('NAO reusa cadastro de documento diferente — cria um novo', async () => {
    h.estado.clientesNoAsaas = [{ id: 'cus_de_outro', name: 'Outra', cpfCnpj: '98765432000100' }];
    await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(h.criarCliente).toHaveBeenCalledTimes(1);
    expect(h.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_novo' }));
  });

  it('busca que falha nao derruba a emissao: cai em criar', async () => {
    h.estado.erroBusca = new Error('Asaas GET /v3/customers → 500');
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r.ok).toBe(true);
    expect(h.criarCliente).toHaveBeenCalledTimes(1);
  });

  it('manda ao Asaas o documento so com digitos', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(h.buscarClientesPorDocumento).toHaveBeenCalledWith('12345678000195');
    expect(h.criarCliente).toHaveBeenCalledWith(expect.objectContaining({ cpfCnpj: '12345678000195' }));
  });
});

// ---------------------------------------------------------------------------
// 9. IDEMPOTENCIA — O SEGUNDO BOLETO NAO PODE NASCER
//
// Estes testes existem para morder o achado que desenhou a 0055: arbitrar
// DEPOIS da chamada ao Asaas nao impede o segundo boleto, so o deixa ORFAO —
// pior que duplicado e rastreado. Tudo aqui e sobre ORDEM e sobre QUANDO o
// trinco volta.
// ---------------------------------------------------------------------------
const HONORARIO = '33333333-3333-4333-8333-333333333333';
const CHAVE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const rpcsDe = (fn: string) => db.rpcs.filter((r) => r.fn === fn);
const idx = (o: string) => h.ordem.indexOf(o);

describe('emitirCobrancaEscritorio — a reserva vem ANTES do Asaas', () => {
  it('o honorario reserva pela chave natural, antes de qualquer chamada ao Asaas', async () => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r.ok).toBe(true);

    expect(rpcsDe('reservar_emissao_cobranca')[0]?.args).toMatchObject({
      p_contabilidade: CONTABILIDADE_ID, p_chave: `hon:${HONORARIO}`,
    });
    // A INVARIANTE INTEIRA EM UMA LINHA: se a reserva escorregar para depois de
    // `criarCobranca`, os dois cliques emitem e o perdedor deixa um orfao.
    expect(idx('rpc:reservar_emissao_cobranca')).toBeGreaterThan(-1);
    expect(idx('rpc:reservar_emissao_cobranca')).toBeLessThan(idx('sub.buscarClientes'));
    expect(idx('rpc:reservar_emissao_cobranca')).toBeLessThan(idx('sub.criarCobranca'));
  });

  it('o avulso reserva pela chave da SUBMISSAO', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ idempotencyKey: CHAVE }));
    expect(rpcsDe('reservar_emissao_cobranca')[0]?.args).toMatchObject({ p_chave: `idem:${CHAVE}` });
  });

  // `z.string().uuid()` aceita hexadecimal MAIUSCULO; o CHECK de formato da 0055
  // (`[0-9a-f]`) nao. Sem a normalizacao, uma chave em maiusculas viraria erro
  // cru de Postgres — na reserva E na linha.
  it('chave em MAIUSCULAS e normalizada na reserva e na linha gravada', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ idempotencyKey: CHAVE.toUpperCase() }));
    expect(rpcsDe('reservar_emissao_cobranca')[0]?.args).toMatchObject({ p_chave: `idem:${CHAVE}` });
    expect(db.insercoes[0].valores).toMatchObject({ idempotency_key: CHAVE });
  });

  it('PERDER a corrida do trinco nao gasta UMA chamada no Asaas', async () => {
    db.donoReserva = null; // a RPC devolveu NULL: outro pedido esta emitindo isto
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toEqual({
      ok: false,
      error: 'Esta cobrança já está sendo emitida agora mesmo. Espere alguns segundos e confira a fatura antes de tentar de novo.',
    });
    // O CORACAO DA TASK: o perdedor nao fala com o Asaas, entao o segundo
    // boleto nao nasce.
    expect(h.asaasSub).not.toHaveBeenCalled();
    expect(h.criarCobranca).not.toHaveBeenCalled();
    expect(db.insercoes).toHaveLength(0);
  });

  // Ao contrario de `limitar()` (rate-limit), que falha ABERTA: la o pior caso e
  // um request a mais; aqui e um boleto real a mais.
  it('trinco indisponivel FALHA FECHADA — nao emite', async () => {
    db.erroReservar = { message: 'could not connect' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Não foi possível confirmar') });
    expect(h.criarCobranca).not.toHaveBeenCalled();
  });

  // Sem chave nenhuma nao ha o que trancar. Esta e a lacuna conhecida do avulso
  // ate a tela existir (Task 10) — declarada aqui para nao virar surpresa.
  it('sem honorario e sem chave NAO ha reserva (lacuna conhecida do avulso)', async () => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido());
    expect(r.ok).toBe(true);
    expect(rpcsDe('reservar_emissao_cobranca')).toHaveLength(0);
    expect(db.insercoes[0].valores).toMatchObject({ idempotency_key: null });
  });
});

describe('emitirCobrancaEscritorio — pre-checagem, COM o trinco na mao', () => {
  it('honorario com cobranca VIVA nao chega ao Asaas e devolve o link que bloqueou', async () => {
    db.cobrancasExistentes = [{ status: 'pendente', link_fatura: 'https://asaas.invalid/i/ja_existe' }];
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toEqual({
      ok: false,
      error: 'Este honorário já tem uma cobrança em aberto. Estorne-a antes de emitir outra.',
      // Sem o link o contador so descobre qual e cacando no Asaas.
      linkFatura: 'https://asaas.invalid/i/ja_existe',
    });
    expect(h.criarCobranca).not.toHaveBeenCalled();
    // E o trinco volta na hora: nao ha nada a proteger, e segura-lo faria o
    // contador esperar o TTL para estornar e recobrar.
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(1);
  });

  it('cobranca PAGA diz a outra frase', async () => {
    db.cobrancasExistentes = [{ status: 'paga', link_fatura: null }];
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toMatchObject({ error: 'Este honorário já tem uma cobrança PAGA. Estorne-a antes de emitir outra.' });
  });

  // Estorno libera a recobranca (decisao do usuario, 28/07). O predicado daqui
  // TEM de concordar com o do indice unico parcial da 0055.
  it('honorario so com cobranca ESTORNADA emite normalmente', async () => {
    db.cobrancasExistentes = [{ status: 'estornada', link_fatura: 'x' }];
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r.ok).toBe(true);
    expect(h.criarCobranca).toHaveBeenCalledTimes(1);
  });

  // A chave descreve um POST que se repetiu, nao uma divida: aqui o status nao
  // importa, e o indice `cobrancas_escritorio_idem_uidx` tambem nao o olha.
  it('chave de submissao repetida bloqueia MESMO com a cobranca estornada', async () => {
    db.cobrancasExistentes = [{ status: 'estornada', link_fatura: 'https://asaas.invalid/i/velha' }];
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ idempotencyKey: CHAVE }));
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringContaining('já foi emitida'),
      linkFatura: 'https://asaas.invalid/i/velha',
    });
    expect(h.criarCobranca).not.toHaveBeenCalled();
  });

  it('a pre-checagem e escopada pelo escritorio do contexto', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    const c = db.consultas.find((q) => q.tabela === 'cobrancas_escritorio');
    expect(c?.eq).toContainEqual(['contabilidade_id', CONTABILIDADE_ID]);
    expect(c?.eq).toContainEqual(['honorario_id', HONORARIO]);
  });

  // A ORDEM E A INVARIANTE. Perguntar antes de reservar deixa a janela em que o
  // vencedor commita a linha entre a pergunta e a reserva do perdedor.
  it('pergunta ao banco DEPOIS de ter o trinco, nunca antes', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    const posReserva = db.rpcs.findIndex((r) => r.fn === 'reservar_emissao_cobranca');
    expect(posReserva).toBe(0);
    // A consulta de cobrancas so aparece depois — e a de `contabilidades`
    // (credencial) e a unica anterior.
    expect(db.consultas.map((c) => c.tabela)).toEqual(['contabilidades', 'cobrancas_escritorio']);
    expect(idx('rpc:reservar_emissao_cobranca')).toBeLessThan(idx('sub.buscarClientes'));
  });

  it('leitura que falha NAO emite no escuro', async () => {
    db.erroLista = { message: 'permission denied' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Não foi possível confirmar') });
    expect(h.criarCobranca).not.toHaveBeenCalled();
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(1);
  });
});

describe('emitirCobrancaEscritorio — quando o trinco volta (e quando NAO volta)', () => {
  it('sucesso: libera o trinco e grava a chave da submissao', async () => {
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ idempotencyKey: CHAVE }));
    expect(r.ok).toBe(true);
    expect(db.insercoes[0].valores).toMatchObject({ idempotency_key: CHAVE });
    expect(rpcsDe('liberar_reserva_cobranca')[0]?.args).toMatchObject({
      p_contabilidade: CONTABILIDADE_ID,
      p_chave: `idem:${CHAVE}`,
      // O `dono` e o que impede um pedido cuja reserva ja venceu de apagar a
      // reserva VIVA de quem a roubou.
      p_dono: 'd0d0d0d0-1111-4111-8111-111111111111',
    });
  });

  it('honorario NAO grava idempotency_key — quem manda e a chave natural', async () => {
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO, idempotencyKey: CHAVE }));
    expect(db.insercoes[0].valores).toMatchObject({ honorario_id: HONORARIO, idempotency_key: null });
  });

  // 4xx = o Asaas RESPONDEU e RECUSOU. Nada nasceu, e prender o contador por
  // dois minutos por um vencimento invalido seria castigo sem motivo.
  it('recusa 4xx do Asaas devolve o trinco na hora', async () => {
    const e = new Error('Asaas POST /v3/payments → 400: invalid_dueDate') as Error & { status: number };
    e.status = 400;
    h.estado.erroCobranca = e;
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r.ok).toBe(false);
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(1);
  });

  // O CASO QUE NAO PODE AFROUXAR: com 5xx/timeout a cobranca PODE ter nascido.
  // Devolver o trinco agora faz o proximo clique virar um segundo boleto certo.
  it.each([
    ['5xx', 502],
    ['sem status (timeout/DNS)', null],
  ])('erro AMBIGUO do Asaas (%s) NAO devolve o trinco', async (_n, status) => {
    const e = new Error('socket hang up') as Error & { status?: number };
    if (status !== null) e.status = status;
    h.estado.erroCobranca = e;
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r.ok).toBe(false);
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(0);
  });

  it('resposta 2xx SEM id tambem e ambigua: o trinco fica', async () => {
    h.estado.cobranca = { invoiceUrl: 'x' };
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(0);
  });

  // Falhar aqui e o unico erro do Asaas que NAO e ambiguo: acontece antes de
  // `criarCobranca`, entao nenhuma cobranca nasceu.
  it('falha ao CADASTRAR o cliente devolve o trinco (a cobranca nem foi tentada)', async () => {
    h.estado.erroBusca = new Error('Asaas GET /v3/customers → 500');
    h.criarCliente.mockRejectedValueOnce(new Error('Asaas POST /v3/customers → 500'));
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toMatchObject({ ok: false });
    expect(h.criarCobranca).not.toHaveBeenCalled();
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(1);
  });

  // A cobranca existe no Asaas e nao existe no banco: nem linha nem indice
  // guardam este alvo. Devolver o trinco seria abrir a porta para o segundo
  // boleto justamente no pior estado possivel.
  it('cobranca emitida e NAO gravada segura o trinco ate o TTL', async () => {
    db.erroInsert = { message: 'permission denied for table cobrancas_escritorio' };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(r).toMatchObject({ error: expect.stringContaining('Confira no Asaas') });
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(0);
  });
});

describe('emitirCobrancaEscritorio — 23505: a rede de baixo', () => {
  const erro23505 = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "cobrancas_escritorio_honorario_viva_uidx"',
  };

  it('vira frase em PORTUGUES com o link, e nunca erro cru de Postgres na tela', async () => {
    db.erroInsert = erro23505;
    // A linha aparece DEPOIS da pre-checagem — do contrario o Asaas nem teria
    // sido chamado, e nao haveria 23505 nenhum para tratar.
    db.aoInserir = () => {
      db.cobrancasExistentes = [{ status: 'pendente', link_fatura: 'https://asaas.invalid/i/bloqueou' }];
    };
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));

    expect(r).toEqual({
      ok: false,
      error: 'Esta cobrança já estava emitida. Pode ter nascido uma segunda cobrança no Asaas sem ficar registrada aqui — confira no Asaas antes de enviar ao cliente e avise o suporte da Balu.',
      linkFatura: 'https://asaas.invalid/i/bloqueou',
    });
    // O texto do Postgres nao chega ao contador em pedaco nenhum.
    expect(JSON.stringify(r)).not.toContain('duplicate key');
    expect(JSON.stringify(r)).not.toContain('23505');
    expect(JSON.stringify(r)).not.toContain('uidx');
  });

  // O boleto orfao existe no Asaas e nao tem linha: sem auditoria propria ele
  // sai do mundo, e o webhook o descarta como 'cobranca_desconhecida'.
  it('registra auditoria PROPRIA do boleto orfao, com o charge id', async () => {
    db.erroInsert = erro23505;
    const r = await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    const a = h.auditorias.find((x) => x.acao === 'cobranca_escritorio.duplicada_bloqueada');
    expect(a?.meta).toMatchObject({ charge_id: 'pay_0001', honorario_id: HONORARIO });
    // Acao DIFERENTE de `nao_gravada`: "ja existia" e "nao consegui gravar"
    // pedem investigacoes opostas.
    expect(h.auditorias.some((x) => x.acao === 'cobranca_escritorio.nao_gravada')).toBe(false);
    expect(r.ok).toBe(false);
  });

  // A linha que bloqueia ja esta no banco e guarda o alvo — o trinco cumpriu o
  // papel dele.
  it('devolve o trinco: a partir daqui quem guarda e o indice', async () => {
    db.erroInsert = erro23505;
    await emitirCobrancaEscritorio(fakeSb(), pedido({ honorarioId: HONORARIO }));
    expect(rpcsDe('liberar_reserva_cobranca')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. ISOLAMENTO DA CARTEIRA
// ---------------------------------------------------------------------------
describe('clienteDaCarteira', () => {
  it('empresa de OUTRO escritorio devolve null', async () => {
    db.company = { id: COMPANY_ID, nome: 'X', cnpj: '1', email: null, contabilidade_id: OUTRA_CONTABILIDADE, deleted_at: null };
    expect(await clienteDaCarteira(fakeSb(), CONTABILIDADE_ID, COMPANY_ID)).toBeNull();
  });

  it('empresa sem escritorio (cliente direto da Balu) devolve null', async () => {
    db.company = { id: COMPANY_ID, nome: 'X', cnpj: '1', email: null, contabilidade_id: null, deleted_at: null };
    expect(await clienteDaCarteira(fakeSb(), CONTABILIDADE_ID, COMPANY_ID)).toBeNull();
  });

  it('empresa apagada nao pode ser cobrada', async () => {
    db.company = { id: COMPANY_ID, nome: 'X', cnpj: '1', email: null, contabilidade_id: CONTABILIDADE_ID, deleted_at: '2026-01-01' };
    expect(await clienteDaCarteira(fakeSb(), CONTABILIDADE_ID, COMPANY_ID)).toBeNull();
  });

  it('empresa da carteira volta com nome, documento e e-mail', async () => {
    db.company = {
      id: COMPANY_ID, nome: null, razao_social: 'Padaria do Ze LTDA', cnpj: '12.345.678/0001-95',
      email: 'ze@padaria.invalid', contabilidade_id: CONTABILIDADE_ID, deleted_at: null,
    };
    // `nome` nulo cai para `razao_social`: mandar string vazia ao Asaas seria
    // uma cobranca sem credor identificado na fatura.
    expect(await clienteDaCarteira(fakeSb(), CONTABILIDADE_ID, COMPANY_ID)).toEqual({
      id: COMPANY_ID, nome: 'Padaria do Ze LTDA', cpfCnpj: '12.345.678/0001-95', email: 'ze@padaria.invalid',
    });
  });
});
