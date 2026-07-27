// Smoke da persistencia de cobranca contra o banco REAL.
//
// Existe porque a investigacao de 2026-07-27 provou que o `upsert` do
// PostgREST manda NULL nas colunas ausentes do payload — o oposto do que a
// versao anterior deste codigo assumia. Uma suposicao sobre o
// comportamento do cliente de banco so se fixa com o banco de verdade.
//
// Pula sem env, igual aos demais smokes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const temEnv = Boolean(URL && KEY);

let sb: SupabaseClient;
let assinaturaId = '';
const CHARGE = `smoke_${Date.now()}`;

const pagamento = {
  value: 49.9, dueDate: '2026-08-10', status: 'RECEIVED',
  invoiceUrl: 'https://asaas/i/1', paymentDate: '2026-08-09',
};

describe.skipIf(!temEnv)('persistirCobranca (banco real)', () => {
  beforeAll(async () => {
    sb = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const { data } = await sb.from('assinaturas').select('id').limit(1).maybeSingle();
    assinaturaId = data?.id ?? '';
  });

  // Limpa mesmo se um teste falhar no meio — a linha e artificial e nao
  // pode sobrar no banco de producao.
  afterAll(async () => {
    if (sb) await sb.from('cobrancas').delete().eq('asaas_charge_id', CHARGE);
  });

  it('achou uma assinatura para pendurar a cobranca', () => {
    expect(assinaturaId).not.toBe('');
  });

  it('insere a cobranca na primeira vez', async () => {
    const { persistirCobranca } = await import('./cobranca');
    const r = await persistirCobranca(
      sb, assinaturaId,
      { tipo: 'pagamento_confirmado', chargeId: CHARGE, subscriptionId: 'sub_x' },
      pagamento);
    expect(r).toEqual({ ok: true, acao: 'inserida' });

    const { data } = await sb.from('cobrancas')
      .select('status, valor_centavos, pago_em').eq('asaas_charge_id', CHARGE).maybeSingle();
    expect(data?.status).toBe('RECEIVED');
    expect(data?.valor_centavos).toBe(4990);
    expect(data?.pago_em).toBe('2026-08-09');
  });

  // O BUG QUE MOTIVOU ESTE ARQUIVO. O Asaas reentrega eventos e nao garante
  // ordem. Com `upsert`, este caso apagava pago_em e devolvia o status para
  // PENDING — a cobranca paga voltava a parecer em aberto para o cliente.
  it('PAYMENT_CREATED fora de ordem NAO apaga o pagamento', async () => {
    const { persistirCobranca } = await import('./cobranca');
    const r = await persistirCobranca(
      sb, assinaturaId,
      { tipo: 'cobranca_criada', chargeId: CHARGE, subscriptionId: 'sub_x' },
      { value: 49.9, dueDate: '2026-08-10', status: 'PENDING' });
    expect(r.ok).toBe(true);

    const { data } = await sb.from('cobrancas')
      .select('status, pago_em').eq('asaas_charge_id', CHARGE).maybeSingle();
    expect(data?.pago_em).toBe('2026-08-09');   // preservado
    expect(data?.status).toBe('RECEIVED');      // nao regrediu
  });

  // Segundo modo de falha do upsert: payload sem `value` gravava 0 por cima
  // do valor real, e a tela mostrava R$ 0,00 ao cliente.
  it('payload sem value NAO zera o valor gravado', async () => {
    const { persistirCobranca } = await import('./cobranca');
    await persistirCobranca(
      sb, assinaturaId,
      { tipo: 'cobranca_criada', chargeId: CHARGE, subscriptionId: 'sub_x' },
      { status: 'PENDING' });

    const { data } = await sb.from('cobrancas')
      .select('valor_centavos, vencimento').eq('asaas_charge_id', CHARGE).maybeSingle();
    expect(data?.valor_centavos).toBe(4990);
    expect(data?.vencimento).toBe('2026-08-10');
  });

  // DISCRIMINANTE: sem este caso, uma implementacao que simplesmente
  // IGNORASSE todo evento posterior passaria nos dois testes acima.
  it('estorno DEPOIS do pagamento atualiza o status', async () => {
    const { persistirCobranca } = await import('./cobranca');
    await persistirCobranca(
      sb, assinaturaId,
      { tipo: 'estorno', chargeId: CHARGE, subscriptionId: 'sub_x' },
      { status: 'REFUNDED', value: 49.9, dueDate: '2026-08-10' });

    const { data } = await sb.from('cobrancas')
      .select('status').eq('asaas_charge_id', CHARGE).maybeSingle();
    expect(data?.status).toBe('REFUNDED');
  });
});
