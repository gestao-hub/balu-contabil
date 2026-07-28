// Bloco 4B — invariantes de `cobrarClienteAction` (o caminho do SERVICO AVULSO).
//
// POR QUE ESTE ARQUIVO EXISTE
// Havia dois caminhos que emitem dinheiro de verdade na subconta do escritorio.
// O do honorario tinha rede; este nao tinha nenhuma — e e ele que decide, sozinho,
// QUAL servico do catalogo vale, POR QUANTO (inclusive percentual sobre uma base
// digitada na hora) e SE ele ainda pode ser cobrado. Nada disso e verificavel por
// `tsc`: inverter o `.eq('contabilidade_id', ctx.id)` da consulta do catalogo ou
// apagar a checagem de `ativo` compila limpo e passava na suite inteira.
//
// Cada teste aqui existe para MORDER uma mudanca que hoje passa pelo
// `tsc --noEmit`:
//   1. ler o catalogo sem escopo de escritorio — e o preco de um servico de
//      outra pessoa definir esta cobranca;
//   2. cobrar por um servico desativado, que a tela ja nao oferece;
//   3. forcar um numero quando o percentual esta sem base (emitir por um valor
//      inventado e pior que recusar);
//   4. trocar o escopo do anti-IDOR da carteira;
//   5. deixar de mandar `servicoAvulsoId` ao motor — e a cobranca nasce sem
//      origem, do lado do honorario ou de lado nenhum.
//
// O motor de emissao (`@/lib/billing/emitir-cobranca`) e mockado inteiro: ele tem
// a sua propria rede em `src/lib/billing/emitir-cobranca.test.ts`. `avulso.ts`
// (a conta do valor) e `zod` (a fronteira) sao os DE VERDADE — e o unico jeito de
// provar que a mensagem que o escritorio le vem da regra, e nao de um atalho.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const OUTRA_CONTABILIDADE = '99999999-9999-4999-8999-999999999999';
const USER_ID = 'user_teste_1';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const SERVICO_ID = '44444444-4444-4444-8444-444444444444';
const SERVICO_DE_OUTRO = '55555555-5555-4555-8555-555555555555';

const CLIENTE = { id: COMPANY_ID, nome: 'Padaria do Ze LTDA', cpfCnpj: '12345678000195', email: null };

const SERVICO_FIXO = {
  id: SERVICO_ID,
  contabilidade_id: CONTABILIDADE_ID,
  nome: 'Abertura de empresa',
  tipo_valor: 'fixo',
  valor_centavos: 90000,
  percentual: null as number | null,
  ativo: true,
};

type Consulta = { tabela: string; eq: unknown[][] };

const h = vi.hoisted(() => {
  const consultas: Array<{ tabela: string; eq: unknown[][] }> = [];

  const estado = {
    guard: null as unknown,
    /** O catalogo COMO ESTA NO BANCO — inclusive linhas de OUTRO escritorio. */
    servicos: [] as Array<Record<string, unknown>>,
    cliente: null as unknown,
    emissao: null as unknown,
  };

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const c = { tabela, eq: [] as unknown[][] };
      consultas.push(c);
      const b = {
        eq: (col: unknown, v: unknown) => { c.eq.push([col, v]); return b; },
        // O fake FILTRA DE VERDADE, aplicando os `.eq` acumulados. Assertar so a
        // lista de `.eq` provaria a FORMA da consulta; aplicando-os, um `.eq`
        // que sumir do codigo deixa de filtrar aqui tambem e a linha do outro
        // escritorio aparece — que e exatamente o que aconteceria em producao,
        // onde o admin client ignora RLS.
        maybeSingle: async () => {
          const linha = estado.servicos.find((s) =>
            c.eq.every(([col, v]) => s[col as string] === v));
          // FIEL AO supabase-js: zero linha e `data: null` sem `error`.
          return { data: linha ?? null, error: null };
        },
      };
      return b;
    },
    // Sem `update`/`insert` de proposito: esta action NAO escreve — quem grava e
    // o motor de emissao, mockado inteiro. Se um dia ela passar a escrever
    // direto, o fake quebra em vez de aceitar em silencio.
  }));

  const emitirCobrancaEscritorio = vi.fn(async (_sb: unknown, _p: unknown) => estado.emissao);
  const clienteDaCarteira = vi.fn(async (_sb: unknown, _cont: string, _company: string) => estado.cliente);
  const revalidatePath = vi.fn();

  return { consultas, estado, from, emitirCobrancaEscritorio, clienteDaCarteira, revalidatePath };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/billing/emitir-cobranca', () => ({
  emitirCobrancaEscritorio: h.emitirCobrancaEscritorio,
  clienteDaCarteira: h.clienteDaCarteira,
}));

import { cobrarClienteAction } from './cobrar-actions';

const consultasDe = (t: string): Consulta[] => h.consultas.filter((c) => c.tabela === t);
/** O pedido que chegou ao motor de emissao. */
const pedidoEmitido = () => h.emitirCobrancaEscritorio.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

const entrada = (over: Record<string, unknown> = {}) => ({
  companyId: COMPANY_ID,
  servicoAvulsoId: SERVICO_ID,
  descricaoLivre: null,
  baseCentavos: null,
  vencimento: '2099-12-10',
  ...over,
});

beforeEach(() => {
  h.consultas.length = 0;
  vi.clearAllMocks();

  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.servicos = [
    { ...SERVICO_FIXO },
    // Mesmo catalogo, escritorio DIFERENTE. So o `.eq('contabilidade_id')` da
    // action separa um do outro.
    {
      id: SERVICO_DE_OUTRO, contabilidade_id: OUTRA_CONTABILIDADE,
      nome: 'Abertura de empresa (do vizinho)', tipo_valor: 'fixo',
      valor_centavos: 1, percentual: null, ativo: true,
    },
  ];
  h.estado.cliente = CLIENTE;
  h.estado.emissao = { ok: true, cobrancaId: 'cob_0001', chargeId: 'pay_0001', linkFatura: 'https://asaas.invalid/i/1' };
});

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// 1. ISOLAMENTO ENTRE ESCRITORIOS — o admin client ignora RLS
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — isolamento do catalogo', () => {
  it('le o servico escopado por id E por contabilidade (anti-IDOR)', async () => {
    await cobrarClienteAction(entrada());
    const c = consultasDe('servicos_avulsos')[0];
    expect(c.eq).toContainEqual(['id', SERVICO_ID]);
    expect(c.eq).toContainEqual(['contabilidade_id', CONTABILIDADE_ID]);
  });

  // O id de um servico de outro escritorio vaza de print, de historico ou de
  // palpite. Sem o escopo, ELE definiria o preco desta cobranca.
  it('servico de OUTRO escritorio nao emite, mesmo com o id correto em maos', async () => {
    const r = await cobrarClienteAction(entrada({ servicoAvulsoId: SERVICO_DE_OUTRO }));
    expect(r).toEqual({ ok: false, error: 'Serviço não encontrado no catálogo.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('servico inexistente diz a mesma frase, sem revelar a diferenca', async () => {
    h.estado.servicos = [];
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({ ok: false, error: 'Serviço não encontrado no catálogo.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. SERVICO DESATIVADO — a tela nao o oferece, a action tambem nao
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — servico desativado', () => {
  it('servico desativado nao emite, com frase que diz o que fazer', async () => {
    h.estado.servicos = [{ ...SERVICO_FIXO, ativo: false }];
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({
      ok: false,
      error: 'Este serviço está desativado — reative-o para poder cobrar.',
    });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. O VALOR — nunca um numero forcado
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — base do percentual', () => {
  const PERCENTUAL = {
    ...SERVICO_FIXO, tipo_valor: 'percentual', valor_centavos: null, percentual: 20,
  };

  // Emitir por um valor inventado sai de graca sem ninguem notar; recusar
  // aparece na hora. A mensagem e PROPRIA de proposito: "informe o valor da
  // cobranca" nao diria ao escritorio que falta a BASE do percentual.
  it('percentual SEM base recusa com mensagem propria e nao emite nada', async () => {
    h.estado.servicos = [{ ...PERCENTUAL }];
    const r = await cobrarClienteAction(entrada({ baseCentavos: null }));
    expect(r).toEqual({
      ok: false,
      error: 'Este serviço é percentual — informe o valor-base da cobrança.',
    });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('percentual com base ZERO tambem recusa — nao vira cobranca de R$ 0,00', async () => {
    h.estado.servicos = [{ ...PERCENTUAL }];
    const r = await cobrarClienteAction(entrada({ baseCentavos: 0 }));
    expect(r).toMatchObject({ ok: false, error: 'Este serviço é percentual — informe o valor-base da cobrança.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  // Duas mensagens diferentes porque sao dois problemas diferentes: uma o
  // escritorio resolve digitando a base agora; a outra, corrigindo o catalogo.
  it('servico FIXO sem valor no catalogo recusa com a OUTRA mensagem', async () => {
    h.estado.servicos = [{ ...SERVICO_FIXO, valor_centavos: null }];
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({
      ok: false,
      error: 'Este serviço está sem valor no catálogo — corrija-o antes de cobrar.',
    });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  it('percentual COM base cobra a porcentagem, com o centavo do empate para cima', async () => {
    h.estado.servicos = [{ ...PERCENTUAL, percentual: 50 }];
    // 12345 * 50% = 6172,5 centavos → 6173, e nao 6172 (truncar favoreceria
    // sistematicamente quem paga).
    await cobrarClienteAction(entrada({ baseCentavos: 12345 }));
    expect(pedidoEmitido()).toMatchObject({ valorCentavos: 6173 });
  });

  it('servico fixo ignora a base digitada — quem manda e o catalogo', async () => {
    await cobrarClienteAction(entrada({ baseCentavos: 12345 }));
    expect(pedidoEmitido()).toMatchObject({ valorCentavos: 90000 });
  });
});

// ---------------------------------------------------------------------------
// 4. ANTI-IDOR DA CARTEIRA
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — carteira', () => {
  it('empresa fora da carteira nao emite e nem chega a consultar o catalogo', async () => {
    h.estado.cliente = null;
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({ ok: false, error: 'Cliente não encontrado na sua carteira.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
    expect(h.consultas).toHaveLength(0);
  });

  it('a carteira e consultada com o escritorio DO CONTEXTO e a empresa DO PEDIDO', async () => {
    await cobrarClienteAction(entrada());
    // Trocar a ordem destes dois argumentos compila — e faria a checagem
    // procurar o escritorio dentro da carteira da empresa.
    expect(h.clienteDaCarteira).toHaveBeenCalledWith(
      expect.anything(), CONTABILIDADE_ID, COMPANY_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. CAMINHO FELIZ — o que chega ao motor decide de que lado a cobranca nasce
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — emissao', () => {
  it('emite com a origem AVULSO preenchida e o honorario vazio', async () => {
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({ ok: true, linkFatura: 'https://asaas.invalid/i/1' });

    expect(pedidoEmitido()).toMatchObject({
      contabilidadeId: CONTABILIDADE_ID,
      userId: USER_ID,
      cliente: CLIENTE,
      descricao: 'Abertura de empresa',
      valorCentavos: 90000,
      vencimento: '2099-12-10',
      // As duas colunas que dizem DE ONDE veio a cobranca em
      // `cobrancas_escritorio`. Sem `servicoAvulsoId` a linha nasce sem origem;
      // com `honorarioId` preenchido nasceria do lado errado, e o webhook
      // marcaria uma mensalidade como paga.
      servicoAvulsoId: SERVICO_ID,
      honorarioId: null,
    });
  });

  it('revalida a pagina do cliente so depois de emitir', async () => {
    await cobrarClienteAction(entrada());
    expect(h.revalidatePath).toHaveBeenCalledWith(`/contador/clientes/${COMPANY_ID}`);
  });

  it('erro do motor volta como erro da action, sem revalidar nada', async () => {
    h.estado.emissao = { ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' };
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({ ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. COBRANCA LIVRE — sem servico do catalogo
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — cobranca livre', () => {
  it('sem servico, valor e descricao vem do formulario e o catalogo nem e lido', async () => {
    const r = await cobrarClienteAction(entrada({
      servicoAvulsoId: null, descricaoLivre: 'Consultoria pontual', baseCentavos: 50000,
    }));
    expect(r).toMatchObject({ ok: true });
    expect(consultasDe('servicos_avulsos')).toHaveLength(0);
    expect(pedidoEmitido()).toMatchObject({
      descricao: 'Consultoria pontual', valorCentavos: 50000, servicoAvulsoId: null,
    });
  });

  it('descricao livre sobrepoe o nome do servico do catalogo', async () => {
    await cobrarClienteAction(entrada({ descricaoLivre: 'Abertura — pacote fechado' }));
    expect(pedidoEmitido()).toMatchObject({
      descricao: 'Abertura — pacote fechado', servicoAvulsoId: SERVICO_ID,
    });
  });

  it.each([
    ['sem valor', { servicoAvulsoId: null, descricaoLivre: 'X', baseCentavos: null }, 'Informe o valor da cobrança.'],
    ['valor negativo', { servicoAvulsoId: null, descricaoLivre: 'X', baseCentavos: -1 }, 'Informe o valor da cobrança.'],
    ['sem descricao', { servicoAvulsoId: null, descricaoLivre: null, baseCentavos: 50000 }, 'Descreva o que está sendo cobrado.'],
  ])('%s nao emite', async (_nome, over, erro) => {
    const r = await cobrarClienteAction(entrada(over as Record<string, unknown>));
    expect(r).toEqual({ ok: false, error: erro });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. FRONTEIRA E VENCIMENTO
// ---------------------------------------------------------------------------
describe('cobrarClienteAction — fronteira e vencimento', () => {
  it('escritorio nao aprovado nem chega a olhar a carteira', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };
    const r = await cobrarClienteAction(entrada());
    expect(r).toEqual({ ok: false, error: 'Escritório não aprovado.' });
    expect(h.clienteDaCarteira).not.toHaveBeenCalled();
    expect(h.consultas).toHaveLength(0);
  });

  it('companyId que nao e uuid nem chega ao banco', async () => {
    const r = await cobrarClienteAction(entrada({ companyId: 'nao-e-uuid' }));
    expect(r).toEqual({ ok: false, error: 'Cliente inválido.' });
    expect(h.clienteDaCarteira).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A CHAVE DE IDEMPOTENCIA DA SUBMISSAO (0055).
  //
  // O avulso nao tem chave natural, entao e ESTE UUID que separa "duplo clique"
  // de "cobrar de novo". Ele nasce no navegador (`crypto.randomUUID()`, uma vez
  // por abertura do formulario) e a action so o repassa — mas repassar e a
  // metade que, se sumir, apaga a trava inteira sem quebrar nada visivel.
  // ─────────────────────────────────────────────────────────────────────────
  it('a chave da submissao chega INTEIRA ao motor de emissao', async () => {
    const K = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await cobrarClienteAction(entrada({ idempotencyKey: K }));
    expect(pedidoEmitido()).toMatchObject({ idempotencyKey: K });
  });

  // `z.string().uuid()` aceita hexadecimal MAIUSCULO; o CHECK de formato da
  // 0055 (`[0-9a-f]`) nao. Sem a normalizacao na fronteira, uma chave em
  // maiusculas viraria erro cru de Postgres na tela do contador.
  it('chave em MAIUSCULAS e normalizada na fronteira', async () => {
    await cobrarClienteAction(entrada({ idempotencyKey: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' }));
    expect(pedidoEmitido()).toMatchObject({ idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  });

  it('chave que nao e uuid e recusada na fronteira, sem emitir nada', async () => {
    const r = await cobrarClienteAction(entrada({ idempotencyKey: 'nao-e-uuid' }));
    expect(r).toEqual({ ok: false, error: 'Chave de emissão inválida.' });
    expect(h.emitirCobrancaEscritorio).not.toHaveBeenCalled();
  });

  // A TELA AINDA NAO EXISTE (Task 10). Enquanto ela nao mandar a chave, este
  // caminho segue SEM TRAVA contra duplo clique — declarado aqui para nao virar
  // surpresa, e nao para ser aceito para sempre.
  it('sem chave a action ainda emite, e o motor recebe null', async () => {
    const r = await cobrarClienteAction(entrada());
    expect(r).toMatchObject({ ok: true });
    expect(pedidoEmitido()).toMatchObject({ idempotencyKey: null });
  });

  it('vencimento no passado recusa em portugues, em vez de erro do Asaas em ingles', async () => {
    const r = await cobrarClienteAction(entrada({ vencimento: '2020-01-10' }));
    expect(r).toEqual({ ok: false, error: 'O vencimento não pode ser anterior a hoje.' });
    expect(h.clienteDaCarteira).not.toHaveBeenCalled();
  });

  // A Vercel roda em UTC: depois das 21h BRT a data UTC ja virou, e comparar
  // com `new Date().toISOString()` recusaria o PROPRIO dia corrente.
  it('o dia de hoje em BRT continua sendo aceito', async () => {
    const r = await cobrarClienteAction(entrada({ vencimento: ymdBrt() }));
    expect(r).toMatchObject({ ok: true });
  });
});
