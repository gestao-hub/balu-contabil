// Bloco 4B — aplicar um pagamento do Asaas na cobrança do escritório.
//
// POR QUE ESTE MÓDULO EXISTE
// Há DOIS caminhos pelos quais o Asaas conta que uma cobrança do escritório
// mudou de estado: o webhook (`api/webhooks/asaas/route.ts`, caminho rápido) e a
// varredura diária de reconciliação (`lib/billing/cron.ts`, rede de segurança).
// Os dois têm de escrever EXATAMENTE a mesma coisa.
//
// Antes deste módulo, o segundo caminho não existia — e o plano do 4B mandava
// escrevê-lo de novo, copiando só a metade fácil. A metade que a cópia perdia é
// o **estorno**: o webhook desfaz o semáforo do honorário quando o dinheiro
// volta, e uma varredura que só soubesse ACENDER deixaria o honorário estornado
// marcado como pago para sempre — impossível de recobrar pela tela, que é
// exatamente o que a decisão de 28/07 quis evitar. Dois caminhos escrevendo
// dinheiro com regras diferentes é a forma mais cara de divergência: ninguém
// nota até um escritório reclamar.
//
// A DECISÃO sobre o efeito do evento continua morando em `cobranca-escritorio.ts`
// (puro, sem I/O): a regra "evento fora de ordem não desfaz pagamento" é sutil
// demais para existir em mais de uma versão. Aqui mora só o I/O que os dois
// caminhos compartilham.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aplicarEventoNaCobranca, statusDoAsaas, type StatusCobranca } from './cobranca-escritorio';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

/** A linha de `cobrancas_escritorio` que os dois caminhos leem. `contabilidade_id`
 *  não é enfeite: é o filtro anti-IDOR do UPDATE no honorário. */
export type CobrancaDoEscritorio = {
  id: string;
  status: string;
  pago_em: string | null;
  honorario_id: string | null;
  contabilidade_id: string;
  /** Quem pagou. Sem isto não há a quem mandar a quitação (Frente 3). */
  empresa_cliente_id: string;
  /** Aparece no corpo do aviso — é como o cliente reconhece a cobrança. */
  descricao: string | null;
};

/**
 * O que os dois caminhos sabem sobre o pagamento.
 *
 * O corpo do webhook (`body.payment`) e o item de `GET /v3/payments` trazem os
 * mesmos três campos — conferido contra o sandbox em 28/07: o item da LISTA
 * também tem `paymentDate` e `confirmedDate`. Por isso a mesma função serve aos
 * dois sem tradução no meio.
 */
export type PagamentoDoAsaas = {
  status?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
};

export type ResultadoAplicacao =
  | { ok: true; mudou: false; motivo: 'sem_efeito' | 'perdeu_corrida' }
  | { ok: true; mudou: true; status: StatusCobranca }
  | { ok: false; erro: 'update_falhou' };

/**
 * A data do pagamento, com o fallback que o 4A aprendeu.
 *
 * Em `PAYMENT_CONFIRMED` (cartão/Pix confirmado, ainda não liquidado) o Asaas
 * manda a confirmação SEM `paymentDate` — só `confirmedDate`. Sem este fallback
 * a cobrança fica "paga" sem data no painel do escritório. `ymdBrt()` é o último
 * recurso: melhor a data de hoje do que um pagamento sem data nenhuma.
 */
function dataDoPagamento(pay: PagamentoDoAsaas): string {
  return pay.paymentDate ?? pay.confirmedDate ?? ymdBrt();
}

/**
 * Grava o efeito do pagamento na cobrança e move o semáforo do honorário.
 *
 * Devolve `mudou: false` quando não há nada a escrever — reentrega do mesmo
 * evento, ou evento fora de ordem que `aplicarEventoNaCobranca` recusa.
 */
export async function aplicarPagamentoNaCobranca(
  sb: SupabaseClient,
  cob: CobrancaDoEscritorio,
  pay: PagamentoDoAsaas,
  origem: 'webhook' | 'reconciliacao',
): Promise<ResultadoAplicacao> {
  const statusEvento = statusDoAsaas(pay.status ?? '');
  const pagoEm = statusEvento === 'paga' ? dataDoPagamento(pay) : null;

  const novo = aplicarEventoNaCobranca(
    { status: String(cob.status), pago_em: cob.pago_em ?? null },
    { status: statusEvento, pagoEm },
  );
  if (!novo) return { ok: true, mudou: false, motivo: 'sem_efeito' };

  // ─── COMPARE-AND-SWAP: `.eq('status', cob.status)` ────────────────────────
  //
  // Não é zelo: sem isto há um LOST UPDATE de verdade, e ele nasceu junto com a
  // varredura. Até a Task 13 o webhook era o ÚNICO escritor desta tabela, e um
  // UPDATE cego por `id` bastava. Agora são DOIS escritores — e a varredura lê
  // uma PÁGINA INTEIRA (até 100 linhas) antes de aplicar uma a uma, então o
  // snapshot da última linha pode estar dezenas de round-trips velho.
  //
  // O estrago concreto: a varredura lê `pay_x` como `pendente`; um
  // PAYMENT_REFUNDED chega e põe a linha em `estornada`, reabrindo o honorário;
  // a varredura então avalia a trava "estorno é terminal" contra o snapshot
  // ANTIGO — onde não havia estorno nenhum — e regrava `paga`, marcando o
  // honorário como pago. O painel do escritório passa a afirmar que entrou
  // dinheiro que já tinha voltado. É exatamente o que
  // `aplicarEventoNaCobranca` existe para impedir, escapando por fora dela:
  // a função decide certo sobre um estado que já não é o do banco.
  //
  // Com a condição, quem chega com snapshot velho afeta ZERO linhas e desiste.
  // O `status` sozinho basta: toda transição perigosa muda o status, e as que
  // mexem só em `pago_em` já são recusadas pela guarda `atual.status === 'paga'`.
  const { data: afetadas, error: erroUpdate } = await sb.from('cobrancas_escritorio')
    .update({ ...novo, updated_at: new Date().toISOString() })
    .eq('id', cob.id)
    .eq('status', cob.status)
    .select('id');
  if (erroUpdate) {
    console.error(`[4b ${origem}] cobranca nao atualizada`, cob.id, erroUpdate.message);
    return { ok: false, erro: 'update_falhou' };
  }
  if (!afetadas || afetadas.length === 0) {
    // Outro escritor moveu a linha entre a leitura e este UPDATE. Não é erro, e
    // NÃO se reconsulta para tentar de novo: quem escreveu por último tinha o
    // estado mais novo, e o webhook dele já cuidou do honorário. A próxima
    // varredura reconcilia se ainda houver o que reconciliar.
    console.warn(`[4b ${origem}] cobranca mudou durante a leitura, aplicacao descartada`, cob.id);
    return { ok: true, mudou: false, motivo: 'perdeu_corrida' };
  }

  // O aviso sai DEPOIS do compare-and-swap ter afetado linha e ANTES do
  // `return` de quem não tem honorário: cobrança avulsa também é dinheiro que
  // entrou, e o cliente que a pagou merece a confirmação do mesmo jeito.
  // Avisar antes do CAS seria anunciar um pagamento que outro escritor pode ter
  // desfeito no mesmo instante.
  if (novo.status === 'paga') await avisarPagamentoConfirmado(sb, cob, origem);

  // ─── O SEMÁFORO DO HONORÁRIO (decisão 7.4) ────────────────────────────────
  // Onde há cobrança pela subconta, quem move o semáforo é o Asaas — e fica
  // MARCADO como tal, para não se confundir com a marcação manual do contador.
  // `honorario_id` (em `cobrancas_escritorio`) é a ligação CANÔNICA; o
  // back-pointer `honorarios.cobranca_escritorio_id` não decide nada aqui.
  //
  // O `.eq('contabilidade_id')` é anti-IDOR: o admin client ignora RLS, e sem
  // ele uma linha com `honorario_id` apontando para fora do escritório dono da
  // cobrança marcaria pago o honorário de outra empresa.
  if (!cob.honorario_id) return { ok: true, mudou: true, status: novo.status };

  if (novo.status === 'paga') {
    const { error } = await sb.from('honorarios').update({
      status: 'pago', data_pagamento: novo.pago_em,
      pagamento_origem: 'asaas', updated_at: new Date().toISOString(),
    }).eq('id', cob.honorario_id).eq('contabilidade_id', cob.contabilidade_id);
    if (error) console.error(`[4b ${origem}] honorario nao marcado como pago`, cob.honorario_id, error.message);
  } else if (novo.status === 'estornada') {
    // O DINHEIRO VOLTOU: o honorário não está pago.
    //
    // Sem isto o caminho só sabe ACENDER o semáforo. `aplicarEventoNaCobranca`
    // já liberou a cobrança (estornada é status MORTO), mas
    // `cobrarHonorarioAction` recusa emitir com `hon.status === 'pago'` — o
    // honorário estornado ficaria impossível de recobrar pela tela.
    //
    // `.eq('pagamento_origem', 'asaas')` é a guarda que faz isto ser seguro:
    // só desfazemos o que NÓS escrevemos a partir do Asaas. Honorário marcado
    // a mão pelo contador (origem 'manual', ou nula) fica intocado — um estorno
    // no Asaas não pode apagar a baixa manual dele.
    const { error } = await sb.from('honorarios').update({
      status: 'pendente', data_pagamento: null,
      pagamento_origem: null, updated_at: new Date().toISOString(),
    })
      .eq('id', cob.honorario_id).eq('contabilidade_id', cob.contabilidade_id)
      .eq('pagamento_origem', 'asaas');
    if (error) console.error(`[4b ${origem}] honorario nao reaberto apos estorno`, cob.honorario_id, error.message);
  }

  return { ok: true, mudou: true, status: novo.status };
}

/**
 * O aviso de "pagamento confirmado" pelo Asaas (Frente 3, §3.3).
 *
 * MORA AQUI, E NÃO NA ROTA DO WEBHOOK. A spec dizia webhook; o código diz que
 * quem escreve o pagamento do escritório são DOIS caminhos — o webhook e a
 * varredura diária — e este módulo existe porque os dois têm de escrever a
 * mesma coisa. Notificar só na rota faria o pagamento descoberto pela varredura
 * passar em silêncio, que é exatamente o defeito que a Frente 3 veio consertar
 * do lado da SERPRO, repetido em outra tabela.
 *
 * DOIS DESTINATÁRIOS, DUAS FRASES (decisão aprovada no card):
 *  - o CLIENTE recebe a quitação — "seu pagamento foi confirmado";
 *  - o ESCRITÓRIO recebe o recebimento — "entrou o pagamento de fulano".
 * É o mesmo fato, mas quem lê é outro e o que ele precisa saber é outro.
 *
 * Falha aqui LOGA E SEGUE: o dinheiro já foi escrito, e um aviso que não saiu
 * não pode desfazer isso nem derrubar quem chamou.
 */
async function avisarPagamentoConfirmado(
  sb: SupabaseClient, cob: CobrancaDoEscritorio, origem: 'webhook' | 'reconciliacao',
): Promise<void> {
  try {
    const { data: empresa } = await sb
      .from('companies').select('user_id, nome, razao_social')
      .eq('id', cob.empresa_cliente_id).maybeSingle();

    const { data: membros } = await sb
      .from('contabilidade_membros').select('user_id')
      .eq('contabilidade_id', cob.contabilidade_id);

    const oQue = cob.descricao?.trim() || 'Cobrança do escritório';
    const cliente = (empresa?.nome as string | null)
      ?? (empresa?.razao_social as string | null) ?? 'seu cliente';

    const linhas: Record<string, unknown>[] = [];

    // Empresa sem dono (cadastrada pelo contador antes de o cliente aceitar o
    // convite) não tem a quem avisar — `companies.user_id` é nullable.
    if (empresa?.user_id) {
      linhas.push({
        owner_user_id: empresa.user_id,
        company_id: cob.empresa_cliente_id,
        tipo: 'pagamento_confirmado',
        severidade: 'info',
        titulo: 'Pagamento confirmado',
        corpo: `${oQue} · confirmado pelo Asaas. Nada a fazer.`,
        entidade_ref: cob.id,
        action_href: '/honorarios',
        // O Asaas REENTREGA eventos — a tabela `cobrancas_escritorio` já carrega
        // essa cicatriz no índice único de `asaas_charge_id` (0053). A chave
        // única por cobrança + o índice (owner_user_id, chave) da 0045 fazem a
        // idempotência ser do banco, não da esperança.
        chave: `pagamento_confirmado:cobranca:${cob.id}`,
      });
    }

    for (const m of membros ?? []) {
      linhas.push({
        owner_user_id: m.user_id,
        company_id: null, // aviso do escritório, não de uma empresa (mesma forma da 0070)
        tipo: 'pagamento_confirmado',
        severidade: 'info',
        titulo: 'Pagamento recebido',
        corpo: `Entrou o pagamento de ${cliente} — ${oQue}.`,
        entidade_ref: cob.id,
        action_href: '/contador/cobrancas',
        chave: `pagamento_confirmado:cobranca:${cob.id}:escritorio`,
      });
    }

    if (linhas.length === 0) return;

    const { error } = await sb
      .from('notifications')
      .upsert(linhas, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
    if (error) console.error(`[4b ${origem}] aviso de pagamento nao criado`, cob.id, error.message);
  } catch (e) {
    console.error(`[4b ${origem}] aviso de pagamento falhou`, cob.id, e instanceof Error ? e.message : e);
  }
}
