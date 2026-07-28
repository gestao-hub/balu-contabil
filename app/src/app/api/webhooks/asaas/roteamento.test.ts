// Task 11 (4B) — o roteamento do webhook do Asaas.
//
// POR QUE ESTE ARQUIVO EXISTE
// A mesma porta passou a atender DOIS DONOS DE DINHEIRO: a assinatura da Balu
// (4A, tabela `cobrancas`, EM PRODUCAO) e o escritorio cobrando os clientes dele
// pela subconta propria (4B, tabela `cobrancas_escritorio`). O que decide qual e
// qual — e o que garante que nenhum dos dois escreve na tabela do outro — nao e
// verificavel por `tsc`.
//
// Cada teste morde uma mudanca que hoje passaria pelo `tsc --noEmit`:
//   1. mandar evento de ASSINATURA para o ramo do escritorio (o 4A pararia de
//      promover assinatura, em producao);
//   2. mandar evento de SUBCONTA para `persistirCobranca` (dinheiro do
//      escritorio caindo na tabela do dinheiro da Balu);
//   3. INSERIR a cobranca desconhecida em vez de so registra-la (boleto orfao
//      viraria linha inventada, sem contabilidade e sem cliente);
//   4. reimplementar no route a decisao de `aplicarEventoNaCobranca` — reentrega
//      voltaria a desfazer pagamento;
//   5. deixar de marcar `pagamento_origem = 'asaas'` (decisao 7.4: o semaforo
//      automatico ficaria indistinguivel da baixa manual do contador);
//   6. deixar o estorno acender e nunca apagar o semaforo — o honorario ficaria
//      impossivel de recobrar pela tela;
//   7. deixar o estorno apagar a baixa MANUAL do contador;
//   8. tirar o `.eq('contabilidade_id')` do UPDATE do honorario (o admin client
//      ignora RLS);
//   9. tratar erro de LEITURA como "cobranca desconhecida" — o evento seria
//      descartado com 200 e o Asaas nunca reentregaria;
//  10. deixar o ramo do escritorio alcancavel sem o segredo do webhook.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SEGREDO = 'segredo-de-teste-do-webhook';
const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const HONORARIO_ID = '33333333-3333-4333-8333-333333333333';
const COBRANCA_ID = '44444444-4444-4444-8444-444444444444';
const ASSINATURA_ID = '55555555-5555-4555-8555-555555555555';
const CHARGE = 'pay_4b_0001';
const SUB = 'sub_4a_0001';

type Op = {
  tabela: string;
  kind: 'select' | 'update' | 'insert';
  valores?: Record<string, unknown>;
  eq: [string, unknown][];
  not: unknown[][];
};

const h = vi.hoisted(() => {
  const ops: {
    tabela: string; kind: 'select' | 'update' | 'insert';
    valores?: Record<string, unknown>; eq: [string, unknown][]; not: unknown[][];
  }[] = [];

  const estado = {
    assinatura: null as Record<string, unknown> | null,
    cobrancaEscritorio: null as Record<string, unknown> | null,
    cobrancaContaMae: null as Record<string, unknown> | null,
    erroSelectEscritorio: null as { message: string } | null,
    erroUpdateEscritorio: null as { message: string } | null,
  };

  const resultadoSelect = (tabela: string) => {
    if (tabela === 'assinaturas') return { data: estado.assinatura, error: null };
    if (tabela === 'cobrancas_escritorio') {
      return estado.erroSelectEscritorio
        ? { data: null, error: estado.erroSelectEscritorio }
        : { data: estado.cobrancaEscritorio, error: null };
    }
    if (tabela === 'cobrancas') return { data: estado.cobrancaContaMae, error: null };
    return { data: null, error: null };
  };

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const op = { tabela, kind: 'select' as const, eq: [] as [string, unknown][], not: [] as unknown[][] };
      ops.push(op);
      const b = {
        eq: (c: string, v: unknown) => { op.eq.push([c, v]); return b; },
        maybeSingle: async () => resultadoSelect(tabela),
        then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve(resultadoSelect(tabela)).then(ok, falhou),
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => {
      const op = { tabela, kind: 'update' as const, valores, eq: [] as [string, unknown][], not: [] as unknown[][] };
      ops.push(op);
      // O UPDATE de `cobrancas_escritorio` e um COMPARE-AND-SWAP desde a Task 13
      // (dois escritores: este webhook e a varredura diaria). O fake HONRA as
      // condicoes `.eq` contra a linha guardada e devolve as LINHAS AFETADAS —
      // um fake que respondesse sempre "afetou" faria o CAS parecer funcionar
      // mesmo quebrado, que e o mock provando a si mesmo.
      const resultado = () => {
        if (tabela !== 'cobrancas_escritorio') return { data: [{ id: 'x' }], error: null };
        if (estado.erroUpdateEscritorio) return { data: null, error: estado.erroUpdateEscritorio };
        const alvo = estado.cobrancaEscritorio;
        const casa = !!alvo && op.eq.every(([col, val]) => col === 'id' || alvo[col] === val);
        return { data: casa ? [{ id: alvo!.id }] : [], error: null };
      };
      const b = {
        eq: (c: string, v: unknown) => { op.eq.push([c, v]); return b; },
        not: (...a: unknown[]) => { op.not.push(a); return b; },
        select: (_c: string) => b,
        then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, falhou),
      };
      return b;
    },
    // Existe SO para ser observado: nenhum caminho deste webhook pode inserir.
    // Sem o metodo, um `insert` acidental viraria TypeError engolido pelo
    // `catch` do route e o teste passaria por engano.
    insert: (valores: Record<string, unknown>) => {
      const op = { tabela, kind: 'insert' as const, valores, eq: [] as [string, unknown][], not: [] as unknown[][] };
      ops.push(op);
      return { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) };
    },
  }));

  const persistirCobranca = vi.fn(async () => ({ ok: true as const, acao: 'atualizada' as const }));

  return { ops, estado, from, persistirCobranca };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/security/rate-limit', () => ({ limitar: async () => true, ipDe: () => '1.2.3.4' }));
vi.mock('@/lib/billing/cobranca', () => ({ persistirCobranca: h.persistirCobranca }));

import { POST } from './route';

// ── helpers ────────────────────────────────────────────────────────────────
const opsDe = (tabela: string): Op[] => h.ops.filter((o) => o.tabela === tabela) as Op[];
const updatesDe = (tabela: string): Op[] => opsDe(tabela).filter((o) => o.kind === 'update');
const inserts = (): Op[] => h.ops.filter((o) => o.kind === 'insert') as Op[];

function evento(
  event: string,
  payment: Record<string, unknown>,
  segredo: string | null = SEGREDO,
): Request {
  return new Request('https://balu.test/api/webhooks/asaas', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(segredo === null ? {} : { 'asaas-access-token': segredo }),
    },
    body: JSON.stringify({ event, payment }),
  });
}

/** Cobranca da subconta: o `payment` NAO tem `subscription`. */
const pagamentoAvulso = (extra: Record<string, unknown> = {}) => ({
  id: CHARGE, value: 199.9, dueDate: '2026-08-10', ...extra,
});

async function corpo(req: Request): Promise<Record<string, unknown>> {
  const res = await POST(req);
  return (await res.json()) as Record<string, unknown>;
}

let erros: unknown[][] = [];
let avisos: unknown[][] = [];

beforeEach(() => {
  h.ops.length = 0;
  vi.clearAllMocks();
  process.env.ASAAS_WEBHOOK_SECRET = SEGREDO;
  h.estado.assinatura = { id: ASSINATURA_ID };
  h.estado.cobrancaEscritorio = null;
  h.estado.cobrancaContaMae = null;
  h.estado.erroSelectEscritorio = null;
  h.estado.erroUpdateEscritorio = null;
  erros = [];
  avisos = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { erros.push(a); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { avisos.push(a); });
});

afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// 4A — O CAMINHO EM PRODUCAO NAO PODE MUDAR
// ═══════════════════════════════════════════════════════════════════════════
describe('conta-mae (4A): evento COM assinatura continua indo para `cobrancas`', () => {
  it('chama persistirCobranca e promove a assinatura, sem tocar no 4B', async () => {
    const r = await corpo(evento('PAYMENT_RECEIVED', {
      id: 'pay_4a_0001', subscription: SUB, status: 'RECEIVED', value: 49.9,
      dueDate: '2026-08-01', paymentDate: '2026-07-28',
    }));

    expect(r).toEqual({ ok: true });
    expect(h.persistirCobranca).toHaveBeenCalledTimes(1);

    const [, assinaturaId, efeito] = h.persistirCobranca.mock.calls[0] as unknown as [
      unknown, string, { tipo: string; chargeId: string; subscriptionId: string | null },
    ];
    expect(assinaturaId).toBe(ASSINATURA_ID);
    expect(efeito).toEqual({ tipo: 'pagamento_confirmado', chargeId: 'pay_4a_0001', subscriptionId: SUB });

    // A promocao da assinatura, com a guarda de cortesia/cancelada intacta.
    const up = updatesDe('assinaturas');
    expect(up).toHaveLength(1);
    expect(up[0].valores?.status).toBe('ativa');
    expect(up[0].eq).toContainEqual(['id', ASSINATURA_ID]);
    expect(up[0].not).toEqual([['status', 'in', '("cortesia","cancelada")']]);

    // O dinheiro da Balu e o do escritorio nao se encostam.
    expect(opsDe('cobrancas_escritorio')).toHaveLength(0);
    expect(opsDe('honorarios')).toHaveLength(0);
  });

  it('assinatura desconhecida continua sendo descartada sem gravar nada', async () => {
    h.estado.assinatura = null;
    const r = await corpo(evento('PAYMENT_RECEIVED', {
      id: 'pay_4a_0002', subscription: 'sub_que_nao_existe', status: 'RECEIVED',
    }));
    expect(r).toEqual({ ok: true, ignored: 'assinatura_desconhecida' });
    expect(h.persistirCobranca).not.toHaveBeenCalled();
    expect(opsDe('cobrancas_escritorio')).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it('PAYMENT_OVERDUE de assinatura continua declarando inadimplencia', async () => {
    await corpo(evento('PAYMENT_OVERDUE', { id: 'pay_4a_0003', subscription: SUB, status: 'OVERDUE' }));
    expect(updatesDe('assinaturas')[0].valores?.status).toBe('inadimplente');
    expect(opsDe('cobrancas_escritorio')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4B — O EVENTO DA SUBCONTA
// ═══════════════════════════════════════════════════════════════════════════
describe('subconta (4B): evento SEM assinatura vai para `cobrancas_escritorio`', () => {
  beforeEach(() => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'pendente', pago_em: null,
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };
  });

  it('acha a cobranca pelo asaas_charge_id e grava paga + pago_em', async () => {
    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({
      status: 'RECEIVED', paymentDate: '2026-07-28',
    })));

    expect(r).toEqual({ ok: true, escritorio: true, mudou: true });

    // A busca e pelo id UNIQUE da cobranca — a unica chave que o evento traz.
    const busca = opsDe('cobrancas_escritorio').find((o) => o.kind === 'select');
    expect(busca?.eq).toEqual([['asaas_charge_id', CHARGE]]);

    const up = updatesDe('cobrancas_escritorio');
    expect(up).toHaveLength(1);
    expect(up[0].valores?.status).toBe('paga');
    expect(up[0].valores?.pago_em).toBe('2026-07-28');
    // `id` + COMPARE-AND-SWAP no status. O CAS entrou na Task 13, quando a
    // varredura diaria virou um SEGUNDO escritor desta tabela: sem ele, um
    // UPDATE cego por `id` sobrescreve quem escreveu entre a leitura e a
    // escrita — e o caso caro e a varredura ressuscitando um estorno.
    expect(up[0].eq).toEqual([['id', COBRANCA_ID], ['status', 'pendente']]);

    // NUNCA pela porta do 4A: este dinheiro nao e da Balu.
    expect(h.persistirCobranca).not.toHaveBeenCalled();
    expect(updatesDe('cobrancas')).toHaveLength(0);
    expect(updatesDe('assinaturas')).toHaveLength(0);
  });

  it('PAYMENT_CONFIRMED sem paymentDate usa confirmedDate — nunca "paga" sem data', async () => {
    await corpo(evento('PAYMENT_CONFIRMED', pagamentoAvulso({
      status: 'CONFIRMED', confirmedDate: '2026-07-27',
    })));
    const up = updatesDe('cobrancas_escritorio')[0];
    expect(up.valores?.status).toBe('paga');
    expect(up.valores?.pago_em).toBe('2026-07-27');
  });

  it('PAYMENT_OVERDUE de cobranca pendente marca vencida, sem pago_em', async () => {
    await corpo(evento('PAYMENT_OVERDUE', pagamentoAvulso({ status: 'OVERDUE' })));
    const up = updatesDe('cobrancas_escritorio')[0];
    expect(up.valores?.status).toBe('vencida');
    expect(up.valores?.pago_em).toBeNull();
    // Vencer nao e pagar: o honorario nao pode ser tocado.
    expect(opsDe('honorarios')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REENTREGA — o Asaas reentrega e reordena
// ═══════════════════════════════════════════════════════════════════════════
describe('evento reentregue nao duplica linha nem desfaz pagamento', () => {
  it('a mesma confirmacao reentregue nao gera escrita nenhuma', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'paga', pago_em: '2026-07-28',
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };
    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({
      status: 'RECEIVED', paymentDate: '2026-07-28',
    })));

    expect(r).toEqual({ ok: true, escritorio: true, mudou: false });
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
    expect(opsDe('honorarios')).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it('OVERDUE que chega DEPOIS do pagamento nao desfaz a cobranca paga', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'paga', pago_em: '2026-07-28',
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };
    const r = await corpo(evento('PAYMENT_OVERDUE', pagamentoAvulso({ status: 'OVERDUE' })));

    expect(r).toEqual({ ok: true, escritorio: true, mudou: false });
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
  });

  it('RECEIVED reentregue nao ressuscita uma cobranca ja estornada', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'estornada', pago_em: null,
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };
    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({
      status: 'RECEIVED', paymentDate: '2026-07-29',
    })));

    expect(r).toEqual({ ok: true, escritorio: true, mudou: false });
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
    expect(opsDe('honorarios')).toHaveLength(0);
  });

  it('a cobranca ja existente NUNCA e reinserida (asaas_charge_id e UNIQUE)', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'pendente', pago_em: null,
      honorario_id: null, contabilidade_id: CONTABILIDADE_ID,
    };
    await corpo(evento('PAYMENT_CREATED', pagamentoAvulso({ status: 'PENDING' })));
    expect(inserts()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COBRANCA DESCONHECIDA — o boleto orfao
// ═══════════════════════════════════════════════════════════════════════════
describe('cobranca desconhecida nao vira linha nova', () => {
  it('registra e responde 200, sem INSERT em tabela nenhuma', async () => {
    h.estado.cobrancaEscritorio = null;
    h.estado.cobrancaContaMae = null;

    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({ status: 'RECEIVED' })));

    expect(r).toEqual({ ok: true, ignored: 'cobranca_desconhecida' });
    expect(inserts()).toHaveLength(0);
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
    expect(updatesDe('cobrancas')).toHaveLength(0);
    expect(opsDe('honorarios')).toHaveLength(0);
    // Sem registro, o boleto orfao some do mundo.
    expect(erros.some((a) => String(a[0]).includes('COBRANCA DESCONHECIDA') && a.includes(CHARGE))).toBe(true);
  });

  it('cobranca da CONTA-MAE sem assinatura no evento nao e confundida com orfa', async () => {
    h.estado.cobrancaEscritorio = null;
    h.estado.cobrancaContaMae = { id: 'cob_4a' };

    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({ status: 'RECEIVED' })));

    expect(r).toEqual({ ok: true, ignored: 'cobranca_conta_mae_sem_assinatura' });
    expect(inserts()).toHaveLength(0);
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
    expect(updatesDe('cobrancas')).toHaveLength(0);
  });

  it('erro de LEITURA nao vira "desconhecida" — responde ok:false para nao mentir', async () => {
    h.estado.erroSelectEscritorio = { message: 'connection reset' };

    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({ status: 'RECEIVED' })));

    expect(r).toEqual({ ok: false, reason: 'leitura_falhou' });
    expect(inserts()).toHaveLength(0);
    expect(updatesDe('cobrancas_escritorio')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O SEMAFORO DO HONORARIO — decisao 7.4
// ═══════════════════════════════════════════════════════════════════════════
describe('honorario pago pela subconta recebe pagamento_origem = asaas', () => {
  beforeEach(() => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'pendente', pago_em: null,
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };
  });

  it('marca pago, com a data do Asaas e a origem automatica', async () => {
    await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({
      status: 'RECEIVED', paymentDate: '2026-07-28',
    })));

    const up = updatesDe('honorarios');
    expect(up).toHaveLength(1);
    expect(up[0].valores?.status).toBe('pago');
    expect(up[0].valores?.data_pagamento).toBe('2026-07-28');
    // A decisao 7.4 inteira mora neste campo: sem ele o semaforo automatico
    // fica indistinguivel da baixa manual do contador.
    expect(up[0].valores?.pagamento_origem).toBe('asaas');
  });

  it('o UPDATE do honorario e filtrado pela contabilidade dona da cobranca', async () => {
    await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({ status: 'RECEIVED', paymentDate: '2026-07-28' })));
    // O admin client ignora RLS: sem este filtro, um `honorario_id` apontando
    // para fora do escritorio marcaria pago o honorario de outra empresa.
    expect(updatesDe('honorarios')[0].eq).toContainEqual(['id', HONORARIO_ID]);
    expect(updatesDe('honorarios')[0].eq).toContainEqual(['contabilidade_id', CONTABILIDADE_ID]);
  });

  it('cobranca de servico avulso (sem honorario) nao toca em honorarios', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'pendente', pago_em: null,
      honorario_id: null, contabilidade_id: CONTABILIDADE_ID,
    };
    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({ status: 'RECEIVED', paymentDate: '2026-07-28' })));
    expect(r).toEqual({ ok: true, escritorio: true, mudou: true });
    expect(opsDe('honorarios')).toHaveLength(0);
  });
});

describe('estorno apaga o semaforo — mas so o que o webhook acendeu', () => {
  it('reabre o honorario para o escritorio poder recobrar', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'paga', pago_em: '2026-07-28',
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };

    await corpo(evento('PAYMENT_REFUNDED', pagamentoAvulso({ status: 'REFUNDED' })));

    expect(updatesDe('cobrancas_escritorio')[0].valores?.status).toBe('estornada');

    const up = updatesDe('honorarios');
    expect(up).toHaveLength(1);
    // Sem isto, `cobrarHonorarioAction` recusa a recobranca com "ja esta
    // marcado como pago" e o honorario estornado fica preso para sempre.
    expect(up[0].valores?.status).toBe('pendente');
    expect(up[0].valores?.data_pagamento).toBeNull();
    expect(up[0].valores?.pagamento_origem).toBeNull();
  });

  it('nao desfaz baixa MANUAL: o UPDATE exige pagamento_origem = asaas', async () => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'paga', pago_em: '2026-07-28',
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };

    await corpo(evento('PAYMENT_REFUNDED', pagamentoAvulso({ status: 'REFUNDED' })));

    // A guarda e do BANCO, no predicado do UPDATE: o webhook so desfaz o que o
    // proprio webhook escreveu.
    expect(updatesDe('honorarios')[0].eq).toContainEqual(['pagamento_origem', 'asaas']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICIDADE — o portao vale igual para os dois ramos
// ═══════════════════════════════════════════════════════════════════════════
describe('sem o segredo do webhook, o ramo do escritorio nem e alcancado', () => {
  it.each([
    ['segredo errado', 'token-de-atacante-com-tamanho-igual'],
    ['sem header', null],
  ])('%s: nada e lido nem escrito', async (_caso, token) => {
    h.estado.cobrancaEscritorio = {
      id: COBRANCA_ID, status: 'pendente', pago_em: null,
      honorario_id: HONORARIO_ID, contabilidade_id: CONTABILIDADE_ID,
    };

    const r = await corpo(evento('PAYMENT_RECEIVED', pagamentoAvulso({
      status: 'RECEIVED', paymentDate: '2026-07-28',
    }), token as string | null));

    expect(r).toEqual({ ok: false, reason: 'unauthorized' });
    expect(h.ops).toHaveLength(0);
    expect(h.persistirCobranca).not.toHaveBeenCalled();
  });
});
