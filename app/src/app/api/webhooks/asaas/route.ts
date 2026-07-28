// Blocos 4A e 4B — Webhook do Asaas. Mesma forma do webhook da Focus:
// rate-limit → segredo → SEMPRE HTTP 200 (o Asaas reenfileira em 4xx/5xx,
// e nao queremos loop).
//
// DOIS DONOS DE DINHEIRO NA MESMA PORTA. O 4A e a assinatura da Balu (tabela
// `cobrancas`, dinheiro DA BALU). O 4B e o escritorio cobrando os clientes DELE
// pela subconta Asaas propria (tabela `cobrancas_escritorio`, dinheiro que nunca
// passa pela Balu). A separacao vale no banco, e vale aqui: nenhum dos dois
// ramos escreve na tabela do outro. Ver o bloco ROTEAMENTO dentro do POST.
//
// AUTENTICIDADE — vale IGUAL para os dois. O unico portao e o segredo
// compartilhado no header `asaas-access-token`, conferido ANTES de qualquer
// leitura do corpo. Ele nao e por conta: e o token que NOS configuramos no
// webhook do Asaas, e a subconta so alcanca o ramo do escritorio se o webhook
// dela for cadastrado com o MESMO segredo. Cadastrada com outro (ou sem), a
// entrega para no `unauthorized` acima e nada e marcado como pago — falha
// ruidosa e inofensiva, que e o lado certo do erro. Ver o relatorio da Task 11:
// hoje NAO ha codigo que cadastre webhook na subconta.
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoDoHeader } from '../segredo';
import { traduzirEvento } from '@/lib/billing/eventos';
import { persistirCobranca, type PagamentoAsaas } from '@/lib/billing/cobranca';
import { aplicarEventoNaCobranca, statusDoAsaas } from '@/lib/billing/cobranca-escritorio';
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

/** O `payment` do webhook tem mais campos que os do 4A. `confirmedDate` importa
 *  aqui porque em PAYMENT_CONFIRMED (cartao/Pix confirmado, ainda nao
 *  liquidado) o Asaas manda a confirmacao SEM `paymentDate` — sem este fallback
 *  a cobranca ficaria "paga" sem data. */
type PagamentoDoEvento = PagamentoAsaas & { confirmedDate?: string };

/**
 * O ramo do ESCRITORIO (4B): cobranca avulsa emitida pela subconta dele.
 *
 * Nao e `export` de proposito — `route.ts` so pode exportar handler HTTP, e o
 * `next build` recusa o resto (o `tsc --noEmit` nao pega).
 *
 * A DECISAO sobre o efeito do evento NAO mora aqui: e de
 * `aplicarEventoNaCobranca` (lib/billing/cobranca-escritorio), o modulo puro que
 * o webhook, a reconciliacao e a tela compartilham. Reimplementa-la aqui seria
 * o terceiro relogio marcando outra hora — e a regra "evento fora de ordem nao
 * desfaz pagamento" e sutil demais para existir em tres versoes.
 */
async function cobrancaDoEscritorio(
  sb: SupabaseClient,
  efeito: { tipo: string; chargeId: string },
  pay: PagamentoDoEvento,
): Promise<NextResponse> {
  const { data: cob, error: erroBusca } = await sb
    .from('cobrancas_escritorio')
    .select('id, status, pago_em, honorario_id, contabilidade_id')
    .eq('asaas_charge_id', efeito.chargeId)
    .maybeSingle();

  // Nao dar por desconhecida uma cobranca que so nao pode ser LIDA: o Asaas
  // reentrega quem responde erro, mas nao quem responde 200 — e um 200 aqui
  // descartaria o evento para sempre. Logar e devolver 200 mesmo assim (a
  // reconciliacao diaria fecha a janela), com motivo DIFERENTE de "desconhecida"
  // para nao mandar ninguem cacar boleto orfao que nao existe.
  if (erroBusca) {
    console.error('[webhook asaas 4b] leitura da cobranca falhou', efeito.chargeId, erroBusca.message);
    return NextResponse.json({ ok: false, reason: 'leitura_falhou' }, { status: 200 });
  }

  if (!cob) {
    // NUNCA INSERIR AQUI. Uma linha criada as cegas a partir do payload nasceria
    // sem contabilidade, sem cliente e sem valor conferido — e as duas colunas
    // sao NOT NULL (0053). Ha dois motivos honestos para nao achar:
    //
    //  1. BOLETO ORFAO — a cobranca nasceu no Asaas e o INSERT falhou
    //     (`emitir-cobranca.ts` registra isso como
    //     `cobranca_escritorio.nao_gravada`). O cliente do escritorio tem o
    //     boleto na mao e o painel nunca o mostra.
    //  2. COBRANCA AVULSA DA CONTA-MAE — nao existe hoje (o 4A so cria por
    //     assinatura), mas se existir um dia cai neste ramo por falta de
    //     `subscription`.
    //
    // O segundo SELECT separa os dois no log. Custa uma leitura so no caminho
    // raro, e e a diferenca entre "procure o boleto orfao" e "o roteamento
    // mandou para o lado errado".
    const { data: naContaMae } = await sb
      .from('cobrancas').select('id').eq('asaas_charge_id', efeito.chargeId).maybeSingle();
    if (naContaMae) {
      console.error('[webhook asaas] cobranca da CONTA-MAE sem assinatura no evento', efeito.chargeId);
      return NextResponse.json({ ok: true, ignored: 'cobranca_conta_mae_sem_assinatura' }, { status: 200 });
    }
    console.error('[webhook asaas 4b] COBRANCA DESCONHECIDA', efeito.tipo, efeito.chargeId);
    return NextResponse.json({ ok: true, ignored: 'cobranca_desconhecida' }, { status: 200 });
  }

  const statusEvento = statusDoAsaas(pay.status ?? '');
  // `pago_em` so nasce quando o evento afirma pagamento — e nunca nulo nesse
  // caso. Mesmo fallback do 4A (`persistirCobranca`): melhor a data de hoje em
  // BRT do que uma cobranca "paga" sem data no painel do escritorio.
  const pagoEm = statusEvento === 'paga'
    ? (pay.paymentDate ?? pay.confirmedDate ?? ymdBrt())
    : null;

  const novo = aplicarEventoNaCobranca(
    { status: String(cob.status), pago_em: (cob.pago_em as string | null) ?? null },
    { status: statusEvento, pagoEm },
  );
  // `null` = reentrega ou evento fora de ordem. Nada a escrever, e o 200 fecha
  // a fila do Asaas.
  if (!novo) return NextResponse.json({ ok: true, escritorio: true, mudou: false }, { status: 200 });

  const { error: erroUpdate } = await sb.from('cobrancas_escritorio')
    .update({ ...novo, updated_at: new Date().toISOString() })
    .eq('id', cob.id);
  if (erroUpdate) {
    console.error('[webhook asaas 4b] cobranca nao atualizada', efeito.chargeId, erroUpdate.message);
    return NextResponse.json({ ok: false, reason: 'update_falhou' }, { status: 200 });
  }

  // ─── O SEMAFORO DO HONORARIO (decisao 7.4) ────────────────────────────────
  // Onde ha cobranca pela subconta, quem move o semaforo e o Asaas — e fica
  // MARCADO como tal, para nao se confundir com a marcacao manual do contador.
  // `honorario_id` (em `cobrancas_escritorio`) e a ligacao CANONICA; o
  // back-pointer `honorarios.cobranca_escritorio_id` nao decide nada aqui.
  //
  // O `.eq('contabilidade_id')` e anti-IDOR: o admin client ignora RLS, e sem
  // ele uma linha com `honorario_id` apontando para fora do escritorio dono da
  // cobranca marcaria pago o honorario de outra empresa.
  if (!cob.honorario_id) return NextResponse.json({ ok: true, escritorio: true, mudou: true }, { status: 200 });

  if (novo.status === 'paga') {
    const { error } = await sb.from('honorarios').update({
      status: 'pago', data_pagamento: novo.pago_em,
      pagamento_origem: 'asaas', updated_at: new Date().toISOString(),
    }).eq('id', cob.honorario_id).eq('contabilidade_id', cob.contabilidade_id);
    if (error) console.error('[webhook asaas 4b] honorario nao marcado como pago', cob.honorario_id, error.message);
  } else if (novo.status === 'estornada') {
    // O DINHEIRO VOLTOU: o honorario nao esta pago.
    //
    // Sem isto o webhook so sabe ACENDER o semaforo. `aplicarEventoNaCobranca`
    // ja liberou a cobranca (estornada e status MORTO), mas
    // `cobrarHonorarioAction` recusa emitir com `hon.status === 'pago'` — o
    // honorario estornado ficaria impossivel de recobrar pela tela, que e
    // exatamente o que a decisao de 28/07 quis evitar.
    //
    // `.eq('pagamento_origem', 'asaas')` e a guarda que faz isto ser seguro: o
    // webhook so desfaz o que O PROPRIO webhook escreveu. Honorario marcado a
    // mao pelo contador (origem 'manual', ou nula) fica intocado — um estorno
    // no Asaas nao pode apagar a baixa manual dele.
    const { error } = await sb.from('honorarios').update({
      status: 'pendente', data_pagamento: null,
      pagamento_origem: null, updated_at: new Date().toISOString(),
    })
      .eq('id', cob.honorario_id).eq('contabilidade_id', cob.contabilidade_id)
      .eq('pagamento_origem', 'asaas');
    if (error) console.error('[webhook asaas 4b] honorario nao reaberto apos estorno', cob.honorario_id, error.message);
  }

  return NextResponse.json({ ok: true, escritorio: true, mudou: true }, { status: 200 });
}

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
    const pay = (body as { payment?: PagamentoDoEvento }).payment ?? {};

    // ═══ ROTEAMENTO — conta-mae (4A) x subconta do escritorio (4B) ══════════
    //
    // O QUE O PAYLOAD NAO TEM: dono. Nem o envelope do evento nem o objeto
    // `payment` trazem conta, carteira ou walletId — conferido contra o objeto
    // REAL do Asaas em `lib/billing/asaas.e2e.test.ts`. Nao ha discriminador
    // autoritativo no corpo. `externalReference` (`<contabilidade>:<cliente>`,
    // escrito por `emitir-cobranca.ts`) chega perto, mas falta em toda cobranca
    // criada pela tela do Asaas e e um campo que o remetente escolhe — decidir
    // POR ELE quem e o dono do dinheiro seria pior que o sinal fraco abaixo.
    //
    // O SINAL DE FORMA: ausencia de `subscription`. O 4A so cria cobranca por
    // ASSINATURA (`asaas.criarAssinatura`); o 4B so cria AVULSA
    // (`asaasSub.criarCobranca`, sem assinatura). E fraco de proposito assumido:
    // uma avulsa emitida um dia na conta-mae tambem cairia no ramo do
    // escritorio.
    //
    // POR QUE ISSO NAO E PERIGOSO: quem decide de verdade e a BUSCA, nao a
    // forma. Os dois ramos so agem sobre linha JA EXISTENTE — `assinaturas` de
    // um lado, `cobrancas_escritorio` do outro — e NENHUM DOS DOIS INSERE. Um
    // evento roteado para o lado errado nao acha nada, vira log e 200. O pior
    // caso e perder uma atualizacao (que a reconciliacao diaria refaz); o que
    // nao acontece nunca e uma cobranca ser INVENTADA na tabela errada, que e o
    // que misturaria o dinheiro da Balu com o do escritorio.
    if (!efeito.subscriptionId) {
      return await cobrancaDoEscritorio(sb, efeito, pay);
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
