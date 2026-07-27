// Bloco 4A — Webhook do Asaas. Mesma forma do webhook da Focus:
// rate-limit → segredo → SEMPRE HTTP 200 (o Asaas reenfileira em 4xx/5xx,
// e nao queremos loop).
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoDoHeader } from '../segredo';
import { traduzirEvento } from '@/lib/billing/eventos';
import { persistirCobranca, type PagamentoAsaas } from '@/lib/billing/cobranca';

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

    // A persistencia mora em lib/billing/cobranca.ts para ser exercitada
    // por teste — a regra de nao-regressao (evento fora de ordem nao pode
    // desfazer um pagamento) e sutil demais para viver sem cobertura.
    const r = await persistirCobranca(sb, assinatura.id, efeito, pay);
    if (!r.ok) {
      console.error('[webhook asaas] erro ao gravar cobranca', r.error);
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
