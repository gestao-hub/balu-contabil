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
// ruidosa e inofensiva, que e o lado certo do erro.
//
// QUEM CADASTRA O WEBHOOK DA SUBCONTA: `lib/billing/webhook-subconta-asaas.ts`,
// chamado pela criacao da subconta e pelo botao "Reconfigurar avisos" da tela
// (contador/configuracoes/subconta). Ele usa `ASAAS_WEBHOOK_SECRET` — o MESMO
// valor conferido logo abaixo — como `authToken` do cadastro. Trocar o segredo
// aqui sem reconfigurar o webhook de cada escritorio derruba TODAS as subcontas
// de uma vez, em silencio: elas continuam emitindo, e nenhum pagamento volta.
//
// ⚠️ O Asaas GERA um `authToken` sozinho quando o cadastro vai sem um, e nunca
// devolve o valor na leitura. Por isso um webhook cadastrado a mao no painel
// parece saudavel e mesmo assim morre aqui no `unauthorized` — e por isso o
// conserto da tela e REESCREVER o webhook, nao diagnosticar.
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoDoHeader } from '../segredo';
import { traduzirEvento } from '@/lib/billing/eventos';
import { persistirCobranca, type PagamentoAsaas } from '@/lib/billing/cobranca';
import { aplicarPagamentoNaCobranca, type CobrancaDoEscritorio } from '@/lib/billing/aplicar-cobranca-escritorio';

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
 * A DECISAO sobre o efeito do evento NAO mora aqui, e a ESCRITA tambem nao: as
 * duas sao de `aplicarPagamentoNaCobranca` (lib/billing/aplicar-cobranca-
 * escritorio), compartilhado com a varredura diaria da Task 13. Este ramo faz
 * so o que e do webhook: achar a linha pelo `asaas_charge_id`, distinguir os
 * motivos de nao achar, e traduzir o resultado em resposta HTTP.
 *
 * Antes da extracao, a escrita morava aqui e a varredura teria a sua propria
 * copia — e a copia que o plano do 4B trazia perdia justamente o desfazer do
 * honorario no estorno.
 */
async function cobrancaDoEscritorio(
  sb: SupabaseClient,
  efeito: { tipo: string; chargeId: string },
  pay: PagamentoDoEvento,
): Promise<NextResponse> {
  const { data: cob, error: erroBusca } = await sb
    .from('cobrancas_escritorio')
    .select('id, status, pago_em, honorario_id, contabilidade_id, empresa_cliente_id, descricao')
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

  const r = await aplicarPagamentoNaCobranca(sb, cob as CobrancaDoEscritorio, pay, 'webhook');
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.erro }, { status: 200 });
  // `mudou: false` = reentrega ou evento fora de ordem. Nada foi escrito, e o
  // 200 fecha a fila do Asaas do mesmo jeito.
  return NextResponse.json({ ok: true, escritorio: true, mudou: r.mudou }, { status: 200 });
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
