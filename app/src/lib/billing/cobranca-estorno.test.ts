// Bloco 4A — a direcao do bug de 27/07 que faltava cobertura.
//
// cobranca.smoke.test.ts ja prova PAYMENT_CREATED fora de ordem nao apagar
// um pagamento (paga -> X), mas pula sem env de banco real e nunca exercitou
// a direcao inversa: estornada -> paga. Este arquivo mocka o Supabase (sem
// rede, sem banco) para poder rodar sempre e morder essa direcao.
//
// O BUG: `pago_em` fica de propósito FORA do patch nos eventos que nao sao
// confirmacao de pagamento, para preserva-lo. Depois de um estorno a linha
// fica com status = REFUNDED (ou REFUND_REQUESTED) e `pago_em` ainda
// preenchido. Um PAYMENT_RECEIVED REENTREGUE — o evento que o Asaas mais
// reenvia — tem `eventoDePagamento = true` e, sem a guarda de estorno,
// reescrevia `status` de volta para RECEIVED: uma cobranca estornada voltava
// a parecer paga.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistirCobranca, type PagamentoAsaas } from './cobranca';

type LinhaCobranca = { id: string; pago_em: string | null; status: string };

/** Fake minimo do que `persistirCobranca` usa: select().eq().maybeSingle(),
 *  insert(...) e update(...).eq(...). Sem rede, sem banco. */
function fakeSb(linha: LinhaCobranca | null) {
  const updates: Record<string, unknown>[] = [];
  const sb = {
    from(_tabela: string) {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _v: string) => ({
            maybeSingle: async () => ({ data: linha, error: null }),
          }),
        }),
        insert: async (_valores: Record<string, unknown>) => ({ error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, _v: string) => {
            updates.push(patch);
            // simula o UPDATE parcial no banco: so o que veio no patch muda.
            if (linha) Object.assign(linha, patch);
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { sb, updates };
}

const ASSINATURA_ID = 'assinatura_1';
const CHARGE = 'pay_estorno_1';

describe('persistirCobranca — estorno e terminal para evento reentregue', () => {
  it('estornada (REFUNDED) + PAYMENT_RECEIVED reentregue NAO ressuscita o status', async () => {
    const linha: LinhaCobranca = { id: 'cob_1', pago_em: '2026-07-20', status: 'REFUNDED' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = {
      value: 49.9, dueDate: '2026-08-10', status: 'RECEIVED',
      invoiceUrl: 'https://asaas/i/1', paymentDate: '2026-08-09',
    };
    const r = await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'pagamento_confirmado', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(r).toEqual({ ok: true, acao: 'atualizada' });
    expect(updates[0]).not.toHaveProperty('status');
    expect(linha.status).toBe('REFUNDED');
  });

  it('estornada (REFUND_REQUESTED) + PAYMENT_RECEIVED reentregue NAO ressuscita o status', async () => {
    const linha: LinhaCobranca = { id: 'cob_1b', pago_em: '2026-07-20', status: 'REFUND_REQUESTED' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = { value: 49.9, dueDate: '2026-08-10', status: 'RECEIVED', paymentDate: '2026-08-09' };
    await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'pagamento_confirmado', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(updates[0]).not.toHaveProperty('status');
    expect(linha.status).toBe('REFUND_REQUESTED');
  });

  it('estornada + evento de pagamento reentregue NAO reescreve pago_em', async () => {
    const linha: LinhaCobranca = { id: 'cob_2', pago_em: '2026-07-20', status: 'REFUNDED' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = { value: 49.9, dueDate: '2026-08-10', status: 'RECEIVED', paymentDate: '2026-08-09' };
    await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'pagamento_confirmado', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(updates[0]).not.toHaveProperty('pago_em');
    expect(linha.pago_em).toBe('2026-07-20'); // data do estorno, intocada
  });

  it('estorno legitimo (mesmo reentregue) continua valendo e gravando o status', async () => {
    const linha: LinhaCobranca = { id: 'cob_3', pago_em: '2026-07-20', status: 'REFUNDED' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = { status: 'REFUNDED', value: 49.9, dueDate: '2026-08-10' };
    const r = await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'estorno', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(r).toEqual({ ok: true, acao: 'atualizada' });
    expect(updates[0]?.status).toBe('REFUNDED');
    // Estorno nunca escreveu pago_em antes desta correcao, e continua nao
    // escrevendo — isso NAO mudou.
    expect(linha.pago_em).toBe('2026-07-20');
  });

  it('caminho normal: pendente -> paga continua funcionando', async () => {
    const linha: LinhaCobranca = { id: 'cob_4', pago_em: null, status: 'PENDING' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = {
      value: 49.9, dueDate: '2026-08-10', status: 'RECEIVED', paymentDate: '2026-08-09',
    };
    const r = await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'pagamento_confirmado', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(r).toEqual({ ok: true, acao: 'atualizada' });
    expect(updates[0]?.status).toBe('RECEIVED');
    expect(updates[0]?.pago_em).toBe('2026-08-09');
    expect(linha.status).toBe('RECEIVED');
    expect(linha.pago_em).toBe('2026-08-09');
  });

  it('paga + PAYMENT_CREATED fora de ordem continua sem regredir (guarda antiga intacta)', async () => {
    const linha: LinhaCobranca = { id: 'cob_5', pago_em: '2026-08-09', status: 'RECEIVED' };
    const { sb, updates } = fakeSb(linha);

    const pay: PagamentoAsaas = { value: 49.9, dueDate: '2026-08-10', status: 'PENDING' };
    await persistirCobranca(
      sb, ASSINATURA_ID,
      { tipo: 'cobranca_criada', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pay);

    expect(updates[0]).not.toHaveProperty('status');
    expect(linha.status).toBe('RECEIVED');
    expect(linha.pago_em).toBe('2026-08-09');
  });
});
