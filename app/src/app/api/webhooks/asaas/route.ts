// Bloco 4A — Webhook do Asaas. Mesma forma do webhook da Focus:
// rate-limit → segredo → SEMPRE HTTP 200 (o Asaas reenfileira em 4xx/5xx,
// e nao queremos loop).
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoDoHeader } from '../segredo';
import { traduzirEvento } from '@/lib/billing/eventos';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Status local da assinatura conforme o efeito. `null` = nao mexe no status:
 *  criar cobranca nao torna ninguem adimplente, e estorno nao e inadimplencia
 *  (quem declara inadimplencia e o PAYMENT_OVERDUE). */
const EFEITO_STATUS: Record<string, 'ativa' | 'inadimplente' | null> = {
  pagamento_confirmado: 'ativa',
  cobranca_vencida: 'inadimplente',
  cobranca_criada: null,
  estorno: null,
};

type PagamentoAsaas = {
  value?: number; dueDate?: string; status?: string;
  invoiceUrl?: string; paymentDate?: string;
};

export async function POST(req: Request) {
  if (!(await limitar(`asaas-webhook:${ipDe(req.headers)}`, 300, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }
  if (!segredoDoHeader(req, 'asaas-access-token', process.env.ASAAS_WEBHOOK_SECRET ?? '')) {
    console.warn('[webhook asaas] segredo invalido/ausente');
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const efeito = traduzirEvento(body);
  if (efeito.tipo === 'ignorado') {
    console.warn('[webhook asaas] ignorado:', efeito.motivo);
    return NextResponse.json({ ok: true, ignored: efeito.motivo }, { status: 200 });
  }

  try {
    const sb = createAdminClient();
    const pay = (body as { payment?: PagamentoAsaas }).payment ?? {};

    // Sem subscriptionId nao ha assinatura a atualizar. Cobranca avulsa nao
    // existe neste bloco (ficou para o 4B).
    if (!efeito.subscriptionId) {
      return NextResponse.json({ ok: true, ignored: 'sem_assinatura' }, { status: 200 });
    }
    const { data: assinatura } = await sb
      .from('assinaturas').select('id')
      .eq('asaas_subscription_id', efeito.subscriptionId)
      .maybeSingle();
    if (!assinatura) {
      console.warn('[webhook asaas] assinatura desconhecida', efeito.subscriptionId);
      return NextResponse.json({ ok: true, ignored: 'assinatura_desconhecida' }, { status: 200 });
    }

    // O Asaas REENTREGA eventos e nao garante ordem (esta rota responde 200
    // ate quando rejeita, entao qualquer coisa pode voltar). Um
    // PAYMENT_CREATED que chega DEPOIS do PAYMENT_RECEIVED nao pode desfazer
    // o pagamento. Por isso lemos a linha atual antes de decidir o que
    // sobrescrever — mesmo espirito do webhook da Focus (route.ts:104-105),
    // que so grava o que veio no callback.
    const { data: atual } = await sb
      .from('cobrancas').select('id, pago_em').eq('asaas_charge_id', efeito.chargeId).maybeSingle();
    const jaPaga = Boolean(atual?.pago_em);
    const eventoDePagamento = efeito.tipo === 'pagamento_confirmado' || efeito.tipo === 'estorno';

    // Idempotencia no nivel do banco: asaas_charge_id e UNIQUE, entao
    // reprocessar o mesmo evento e upsert, nunca linha nova.
    const linha: Record<string, unknown> = {
      assinatura_id: assinatura.id,
      asaas_charge_id: efeito.chargeId,
      updated_at: new Date().toISOString(),
    };
    // Campos ausentes do payload ficam INTOCADOS no update (e no default no
    // insert). Sem essa guarda, um payload sem `value` gravaria 0 por cima
    // do valor real, e a tela mostraria R$ 0,00 ao cliente.
    if (pay.invoiceUrl) linha.link_fatura = pay.invoiceUrl;
    if (typeof pay.value === 'number') linha.valor_centavos = Math.round(pay.value * 100);
    if (pay.dueDate) linha.vencimento = pay.dueDate;

    // `status` so regride se o evento for mesmo sobre pagamento. Um
    // PAYMENT_CREATED atrasado nao devolve uma cobranca paga para PENDING.
    if (!jaPaga || eventoDePagamento) {
      linha.status = pay.status ?? 'DESCONHECIDO';
    }
    if (efeito.tipo === 'pagamento_confirmado') {
      linha.pago_em = pay.paymentDate ?? ymdBrt();
    }
    // Insert precisa dos NOT NULL; se o payload nao trouxe, usa um default.
    if (!atual) {
      linha.status ??= pay.status ?? 'DESCONHECIDO';
      linha.valor_centavos ??= 0;
      linha.vencimento ??= ymdBrt();
    }

    const { error: erroCobranca } = await sb
      .from('cobrancas').upsert(linha, { onConflict: 'asaas_charge_id' });
    if (erroCobranca) {
      console.error('[webhook asaas] erro ao gravar cobranca', erroCobranca.message);
    }

    const novoStatus = EFEITO_STATUS[efeito.tipo];
    if (novoStatus) {
      // `cortesia` e `cancelada` nunca sao tocadas por evento de pagamento:
      // a primeira e liberacao por decisao interna, sem cobranca real; a
      // segunda e democao deliberada do titular, e um boleto pago minutos
      // antes do cancelamento (ou uma reentrega do Asaas) nao pode
      // ressuscitar a conta.
      const { error: erroAssinatura } = await sb.from('assinaturas')
        .update({ status: novoStatus, updated_at: new Date().toISOString() })
        .eq('id', assinatura.id)
        .not('status', 'in', '("cortesia","cancelada")');
      if (erroAssinatura) {
        console.error('[webhook asaas] erro ao atualizar assinatura', erroAssinatura.message);
      }
    }
  } catch (err) {
    console.error('[webhook asaas] erro inesperado', err);
  }

  // SEMPRE 200 — o Asaas reenfileira em 4xx/5xx.
  return NextResponse.json({ ok: true }, { status: 200 });
}
