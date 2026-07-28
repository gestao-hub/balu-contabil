// Task 13 do 4B — a varredura que reconcilia as cobranças das subcontas.
//
// POR QUE ESTE ARQUIVO EXISTE
// Esta varredura é a REDE DE SEGURANÇA do dinheiro do escritório: é o que faz um
// pagamento aparecer mesmo quando o webhook não chegou — e o webhook não chega
// quando a URL é localhost, quando o firewall bloqueia, quando ninguém cadastrou
// o webhook na subconta, ou quando o `ASAAS_WEBHOOK_SECRET` mudou sem
// reconfigurar cada escritório. Todos esses casos são silenciosos. Se a rede
// tiver um furo, o furo também é silencioso: o cliente do escritório é cobrado
// de novo por algo que já pagou.
//
// Cada teste aqui existe para MORDER uma mudança que hoje passaria por
// `tsc --noEmit`, por `next build` e pelo resto da suíte:
//   1. ler a credencial FORA do `try` — UMA contabilidade corrompida derruba a
//      reconciliação de TODAS (era exatamente o que o plano do 4B mandava);
//   2. filtrar os escritórios por `asaas_subconta_status = 'aprovada'` — um KYC
//      que regride faz os boletos já emitidos nunca mais baixarem;
//   3. copiar a metade fácil da escrita e perder o desfazer do semáforo do
//      honorário no estorno (a outra armadilha do plano);
//   4. ler só a primeira página do Asaas — a rede vira buraco no escritório com
//      mais de 100 cobranças, que é o que tem mais dinheiro em jogo;
//   5. truncar em silêncio ao bater no teto de páginas;
//   6. INSERIR a cobrança que não está na nossa tabela (a que o escritório criou
//      pelo painel do Asaas);
//   7. tirar o `.eq('contabilidade_id')` da leitura — o admin client ignora RLS;
//   8. tratar erro de LEITURA como "nenhuma cobrança" e reportar sucesso;
//   9. deixar a chave da subconta cair em log.
//
// A CIFRA É A DE VERDADE, com uma CERT_ENC_KEY de teste: é o único jeito de
// provar que o token que chega ao Asaas saiu da coluna cifrada — e de exercitar
// o `throw` real de `lerCredencial` no teste 1, em vez de um `throw` mockado.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { guardarCredencial } from './credencial-subconta';

// Valores obviamente falsos: nenhuma chave real deve existir num fixture.
const CHAVE_A = '$aact_TESTE_chave_falsa_do_escritorio_A_0001';
const CHAVE_B = '$aact_TESTE_chave_falsa_do_escritorio_B_0002';
const ESC_A = '11111111-1111-4111-8111-111111111111';
const ESC_B = '22222222-2222-4222-8222-222222222222';
const ESC_CORROMPIDO = '33333333-3333-4333-8333-333333333333';
const HONORARIO_ID = '44444444-4444-4444-8444-444444444444';

type Op = {
  tabela: string;
  kind: 'select' | 'update' | 'insert';
  valores?: Record<string, unknown>;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  not: unknown[][];
};

const h = vi.hoisted(() => {
  const ops: Array<{
    tabela: string; kind: 'select' | 'update' | 'insert';
    valores?: Record<string, unknown>; eq: [string, unknown][];
    in: [string, unknown[]][]; not: unknown[][];
  }> = [];

  const estado = {
    /** Linhas de `contabilidades` que o SELECT devolve. */
    escritorios: [] as Array<Record<string, unknown>>,
    /** Linhas de `cobrancas_escritorio`, por id de escritório. */
    cobrancas: {} as Record<string, Array<Record<string, unknown>>>,
    erroSelectContabilidades: null as { message: string } | null,
    erroSelectCobrancas: null as { message: string } | null,
    /** Páginas devolvidas por `listarCobrancas`, por token. */
    paginas: {} as Record<string, Array<{ data: unknown[]; hasMore?: boolean }>>,
    erroAsaas: null as unknown,
  };

  /** Toda chamada a `listarCobrancas`, com o token usado — é o que prova que
   *  cada escritório é varrido com a chave DELE, e não com a da conta-mãe. */
  const chamadas: Array<{ token: string; offset: number }> = [];

  const from = vi.fn((tabela: string) => {
    const novaOp = (kind: 'select' | 'update' | 'insert', valores?: Record<string, unknown>) => {
      const op = {
        tabela, kind, valores,
        eq: [] as [string, unknown][], in: [] as [string, unknown[]][], not: [] as unknown[][],
      };
      ops.push(op);
      return op;
    };

    const resultadoSelect = (op: Op) => {
      if (tabela === 'contabilidades') {
        return estado.erroSelectContabilidades
          ? { data: null, error: estado.erroSelectContabilidades }
          : { data: estado.escritorios, error: null };
      }
      if (tabela === 'cobrancas_escritorio') {
        if (estado.erroSelectCobrancas) return { data: null, error: estado.erroSelectCobrancas };
        // O fake HONRA o `.eq('contabilidade_id')` e o `.in(...)`: um teste que
        // apagasse esse filtro do código de produção tem de VER a diferença.
        const dono = op.eq.find(([c]) => c === 'contabilidade_id')?.[1] as string | undefined;
        const ids = (op.in.find(([c]) => c === 'asaas_charge_id')?.[1] ?? []) as string[];
        const todas = dono === undefined
          ? Object.values(estado.cobrancas).flat()
          : (estado.cobrancas[dono] ?? []);
        return { data: todas.filter((l) => ids.includes(l.asaas_charge_id as string)), error: null };
      }
      return { data: [], error: null };
    };

    return {
      select: (_cols: string) => {
        const op = novaOp('select');
        const b: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { op.eq.push([c, v]); return b; },
          in: (c: string, v: unknown[]) => { op.in.push([c, v]); return b; },
          not: (...a: unknown[]) => { op.not.push(a); return b; },
          maybeSingle: async () => resultadoSelect(op as Op),
          then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
            Promise.resolve(resultadoSelect(op as Op)).then(ok, falhou),
        };
        return b;
      },
      update: (valores: Record<string, unknown>) => {
        const op = novaOp('update', valores);
        const b: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { op.eq.push([c, v]); return b; },
          not: (...a: unknown[]) => { op.not.push(a); return b; },
          then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(ok, falhou),
        };
        return b;
      },
      // Existe SÓ para ser observado: nenhum caminho desta varredura pode
      // inserir. Sem o método, um `insert` acidental viraria TypeError engolido
      // pelo `catch` por escritório e o teste passaria por engano.
      insert: (valores: Record<string, unknown>) => {
        novaOp('insert', valores);
        return { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) };
      },
    };
  });

  const asaasSub = vi.fn((token: string) => ({
    listarCobrancas: async (offset = 0) => {
      chamadas.push({ token, offset });
      if (estado.erroAsaas) throw estado.erroAsaas;
      const pgs = estado.paginas[token] ?? [{ data: [], hasMore: false }];
      // Traduz `offset` em índice de página somando os tamanhos — assim o teste
      // de paginação morde de verdade se o código parar de avançar o offset.
      let acumulado = 0;
      for (const p of pgs) {
        if (acumulado === offset) return p;
        acumulado += p.data.length;
      }
      return { data: [], hasMore: false };
    },
  }));

  return { ops, estado, from, asaasSub, chamadas };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/clients/asaas', () => ({ asaasSub: h.asaasSub }));

import { sincronizarCobrancasEscritorio } from './cron';

// ── helpers ────────────────────────────────────────────────────────────────
const opsDe = (tabela: string): Op[] => h.ops.filter((o) => o.tabela === tabela) as Op[];
const updatesDe = (tabela: string): Op[] => opsDe(tabela).filter((o) => o.kind === 'update');
const inserts = (): Op[] => h.ops.filter((o) => o.kind === 'insert') as Op[];

const pagamento = (extra: Record<string, unknown> = {}) => ({
  id: 'pay_0001', value: 199.9, dueDate: '2026-08-10', status: 'PENDING',
  paymentDate: null, confirmedDate: null, ...extra,
});

const linha = (extra: Record<string, unknown> = {}) => ({
  id: 'cob_0001', asaas_charge_id: 'pay_0001', status: 'pendente', pago_em: null,
  honorario_id: null, contabilidade_id: ESC_A, ...extra,
});

let erros: unknown[][] = [];

beforeAll(() => {
  // Mesma convenção de credencial-subconta.test.ts: chave fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.ops.length = 0;
  h.chamadas.length = 0;
  vi.clearAllMocks();
  h.estado.escritorios = [];
  h.estado.cobrancas = {};
  h.estado.paginas = {};
  h.estado.erroSelectContabilidades = null;
  h.estado.erroSelectCobrancas = null;
  h.estado.erroAsaas = null;
  erros = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { erros.push(a); });
});

afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. UMA CONTABILIDADE CORROMPIDA NÃO DERRUBA AS OUTRAS
// ═══════════════════════════════════════════════════════════════════════════
describe('credencial ilegível de um escritório não cega a varredura dos outros', () => {
  it('o escritório seguinte continua sendo reconciliado', async () => {
    h.estado.escritorios = [
      // Valor SEM o prefixo `enc:v1:` — `lerCredencial` LANÇA nele. É a gravação
      // corrompida de verdade, não um mock de exceção.
      { id: ESC_CORROMPIDO, asaas_api_key_cifrada: 'chave-em-claro-sem-cifra' },
      { id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) },
    ];
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'RECEIVED', paymentDate: '2026-08-09' })], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [linha()];

    const r = await sincronizarCobrancasEscritorio();

    expect(r.erros).toBe(1);
    expect(r.atualizadas).toBe(1);
    // A prova de que o segundo foi varrido DE FATO, e não só contado.
    expect(h.chamadas.map((c) => c.token)).toEqual([CHAVE_A]);
    const up = updatesDe('cobrancas_escritorio');
    expect(up).toHaveLength(1);
    expect(up[0].valores).toMatchObject({ status: 'paga', pago_em: '2026-08-09' });
  });

  it('o log da falha NUNCA contém a chave da subconta, mesmo vinda de erro alheio', async () => {
    h.estado.escritorios = [{ id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) }];
    // O pior caso: um erro montado FORA daqui que carrega o token no texto.
    // Hoje o cliente Asaas não faz isso — mas a mensagem é montada longe, e a
    // regra do módulo da credencial é "nunca entra em log, INCLUSIVE log de erro".
    h.estado.erroAsaas = new Error(`Asaas fora do ar (token ${CHAVE_A})`);

    const r = await sincronizarCobrancasEscritorio();

    expect(r.erros).toBe(1);
    const tudo = JSON.stringify(erros);
    expect(tudo).not.toContain(CHAVE_A);
    // A cauda da chave é o que a torna utilizável — nem ela sobrevive.
    expect(tudo).not.toContain(CHAVE_A.slice(7));
    // O que fica é a forma mascarada: identifica a chave sem entregá-la (o
    // prefixo `$aact_` é o contrato de `mascarar`, e não autentica nada).
    expect(tudo).toContain('$aact_…');
  });

  it('erro na leitura dos escritórios é contado, não devolvido como "nada a fazer"', async () => {
    h.estado.erroSelectContabilidades = { message: 'permission denied' };

    const r = await sincronizarCobrancasEscritorio();

    expect(r.erros).toBe(1);
    expect(r.escritorios).toBe(0);
    expect(h.chamadas).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. O FILTRO DOS ESCRITÓRIOS
// ═══════════════════════════════════════════════════════════════════════════
describe('quem entra na varredura', () => {
  it('NÃO filtra por asaas_subconta_status — boleto já emitido baixa mesmo com KYC regredido', async () => {
    h.estado.escritorios = [{ id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) }];
    h.estado.paginas[CHAVE_A] = [{ data: [], hasMore: false }];

    await sincronizarCobrancasEscritorio();

    const sel = opsDe('contabilidades').filter((o) => o.kind === 'select');
    expect(sel).toHaveLength(1);
    // Nenhum `.eq('asaas_subconta_status', ...)`: exigir 'aprovada' aqui faria
    // os pagamentos de um escritório com KYC vencido nunca mais baixarem.
    expect(sel[0].eq.map(([c]) => c)).not.toContain('asaas_subconta_status');
    // Mas exige credencial guardada — sem chave não há o que consultar.
    expect(sel[0].not).toContainEqual(['asaas_api_key_cifrada', 'is', null]);
  });

  it('cada escritório é varrido com a chave DELE', async () => {
    h.estado.escritorios = [
      { id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) },
      { id: ESC_B, asaas_api_key_cifrada: guardarCredencial(CHAVE_B) },
    ];
    h.estado.paginas[CHAVE_A] = [{ data: [], hasMore: false }];
    h.estado.paginas[CHAVE_B] = [{ data: [], hasMore: false }];

    const r = await sincronizarCobrancasEscritorio();

    expect(r.escritorios).toBe(2);
    expect(h.chamadas.map((c) => c.token).sort()).toEqual([CHAVE_A, CHAVE_B].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A ESCRITA É A MESMA DO WEBHOOK — INCLUSIVE O ESTORNO
// ═══════════════════════════════════════════════════════════════════════════
describe('o semáforo do honorário', () => {
  beforeEach(() => {
    h.estado.escritorios = [{ id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) }];
  });

  it('pagamento marca o honorário como pago, com origem `asaas`', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'RECEIVED', paymentDate: '2026-08-09' })], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [linha({ honorario_id: HONORARIO_ID })];

    await sincronizarCobrancasEscritorio();

    const up = updatesDe('honorarios');
    expect(up).toHaveLength(1);
    expect(up[0].valores).toMatchObject({
      status: 'pago', data_pagamento: '2026-08-09', pagamento_origem: 'asaas',
    });
    // Anti-IDOR: o admin client ignora RLS.
    expect(up[0].eq).toContainEqual(['contabilidade_id', ESC_A]);
  });

  it('CONFIRMED sem paymentDate usa confirmedDate — nunca "paga" sem data', async () => {
    h.estado.paginas[CHAVE_A] = [{
      data: [pagamento({ status: 'CONFIRMED', paymentDate: null, confirmedDate: '2026-08-11' })],
      hasMore: false,
    }];
    h.estado.cobrancas[ESC_A] = [linha()];

    await sincronizarCobrancasEscritorio();

    expect(updatesDe('cobrancas_escritorio')[0].valores).toMatchObject({
      status: 'paga', pago_em: '2026-08-11',
    });
  });

  it('ESTORNO reabre o honorário — a metade que a cópia do plano perdia', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'REFUNDED' })], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [
      linha({ status: 'paga', pago_em: '2026-08-09', honorario_id: HONORARIO_ID }),
    ];

    await sincronizarCobrancasEscritorio();

    expect(updatesDe('cobrancas_escritorio')[0].valores).toMatchObject({
      status: 'estornada', pago_em: null,
    });
    const up = updatesDe('honorarios');
    expect(up).toHaveLength(1);
    expect(up[0].valores).toMatchObject({
      status: 'pendente', data_pagamento: null, pagamento_origem: null,
    });
    // Só desfaz o que veio do Asaas: baixa manual do contador fica intocada.
    expect(up[0].eq).toContainEqual(['pagamento_origem', 'asaas']);
  });

  it('evento fora de ordem não desfaz pagamento (a decisão continua sendo do módulo puro)', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'OVERDUE' })], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [linha({ status: 'paga', pago_em: '2026-08-09' })];

    const r = await sincronizarCobrancasEscritorio();

    expect(r.atualizadas).toBe(0);
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
  });

  it('cobrança sem honorário (serviço avulso) não toca em honorarios', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'RECEIVED', paymentDate: '2026-08-09' })], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [linha({ honorario_id: null })];

    await sincronizarCobrancasEscritorio();

    expect(updatesDe('honorarios')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PAGINAÇÃO — a rede não pode ter janela
// ═══════════════════════════════════════════════════════════════════════════
describe('varre até o fim, não só a primeira página', () => {
  beforeEach(() => {
    h.estado.escritorios = [{ id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) }];
  });

  it('segue enquanto `hasMore` e reconcilia a cobrança da SEGUNDA página', async () => {
    h.estado.paginas[CHAVE_A] = [
      { data: [pagamento({ id: 'pay_pagina_1' })], hasMore: true },
      { data: [pagamento({ id: 'pay_pagina_2', status: 'RECEIVED', paymentDate: '2026-08-09' })], hasMore: false },
    ];
    h.estado.cobrancas[ESC_A] = [
      linha({ id: 'cob_1', asaas_charge_id: 'pay_pagina_1' }),
      linha({ id: 'cob_2', asaas_charge_id: 'pay_pagina_2' }),
    ];

    const r = await sincronizarCobrancasEscritorio();

    expect(h.chamadas.map((c) => c.offset)).toEqual([0, 1]);
    expect(r.atualizadas).toBe(1);
    expect(updatesDe('cobrancas_escritorio')[0].eq).toContainEqual(['id', 'cob_2']);
  });

  it('para quando `hasMore` é falso, sem pedir a página seguinte', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento()], hasMore: false }];
    h.estado.cobrancas[ESC_A] = [linha()];

    await sincronizarCobrancasEscritorio();

    expect(h.chamadas).toHaveLength(1);
  });

  it('teto de páginas é CONTADO e LOGADO — varredura truncada em silêncio parece completa', async () => {
    // `hasMore` que nunca desce: o freio de emergência.
    h.estado.paginas[CHAVE_A] = Array.from({ length: 60 }, (_, i) => ({
      data: [pagamento({ id: `pay_${i}` })], hasMore: true,
    }));

    const r = await sincronizarCobrancasEscritorio();

    expect(r.truncados).toBe(1);
    expect(h.chamadas.length).toBe(50);
    expect(JSON.stringify(erros)).toContain('truncada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. O QUE A VARREDURA NUNCA FAZ
// ═══════════════════════════════════════════════════════════════════════════
describe('a varredura não inventa nem mistura dinheiro', () => {
  beforeEach(() => {
    h.estado.escritorios = [{ id: ESC_A, asaas_api_key_cifrada: guardarCredencial(CHAVE_A) }];
  });

  it('cobrança criada pelo painel do Asaas NÃO vira linha nova', async () => {
    h.estado.paginas[CHAVE_A] = [{
      data: [pagamento({ id: 'pay_feito_no_painel', status: 'RECEIVED', paymentDate: '2026-08-09' })],
      hasMore: false,
    }];
    h.estado.cobrancas[ESC_A] = [];

    const r = await sincronizarCobrancasEscritorio();

    expect(inserts()).toHaveLength(0);
    expect(r.atualizadas).toBe(0);
    expect(r.erros).toBe(0);
  });

  it('a leitura das cobranças é recortada pela contabilidade dona da chave', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento({ status: 'RECEIVED', paymentDate: '2026-08-09' })], hasMore: false }];
    // A MESMA charge, mas a linha pertence a OUTRO escritório. Sem o recorte, a
    // chave de um escritório escreveria na cobrança de outro.
    h.estado.cobrancas[ESC_B] = [linha({ contabilidade_id: ESC_B })];

    const r = await sincronizarCobrancasEscritorio();

    const sel = opsDe('cobrancas_escritorio').filter((o) => o.kind === 'select');
    expect(sel[0].eq).toContainEqual(['contabilidade_id', ESC_A]);
    expect(r.atualizadas).toBe(0);
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
  });

  it('erro de LEITURA das cobranças vira erro contado, não "nenhuma cobrança"', async () => {
    h.estado.paginas[CHAVE_A] = [{ data: [pagamento()], hasMore: false }];
    h.estado.erroSelectCobrancas = { message: 'permission denied' };

    const r = await sincronizarCobrancasEscritorio();

    expect(r.erros).toBe(1);
    expect(r.atualizadas).toBe(0);
  });
});
