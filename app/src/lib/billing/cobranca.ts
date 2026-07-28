// Bloco 4A — persistencia de uma cobranca vinda do webhook do Asaas.
//
// MORA AQUI E NAO NA ROUTE para poder ser exercitada por teste: a logica de
// nao-regressao (evento fora de ordem nao pode desfazer um pagamento) e
// sutil demais para viver sem cobertura.
//
// POR QUE `update`/`insert` E NAO `upsert` — provado contra o banco em
// 2026-07-27: o upsert do PostgREST monta a linha INTEIRA e manda NULL nas
// colunas ausentes do payload. Um upsert parcial em `cobrancas` estoura
// "null value in column status violates not-null constraint", e omitir
// `pago_em` para preserva-lo na verdade o APAGA. `update` parcial preserva
// as demais colunas — e e o que o webhook da Focus ja fazia
// (api/webhooks/focus/route.ts:97-114).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { efeitoDoStatusCobranca, type EfeitoEvento } from './eventos';

export type PagamentoAsaas = {
  value?: number; dueDate?: string; status?: string;
  invoiceUrl?: string;
  /** `string | null` porque e o que o Asaas devolve de verdade: em cobranca nao
   *  paga o campo vem `null`, nao ausente (observado no sandbox em 28/07). O
   *  tipo dizia so `string | undefined`, e o `??` abaixo ja tratava os dois —
   *  era o TIPO que estava mentindo, nao o codigo. */
  paymentDate?: string | null;
};

export type ResultadoPersistencia =
  | { ok: true; acao: 'inserida' | 'atualizada' }
  | { ok: false; error: string };

type EfeitoComCobranca = Extract<EfeitoEvento, { chargeId: string }>;

export async function persistirCobranca(
  sb: SupabaseClient,
  assinaturaId: string,
  efeito: EfeitoComCobranca,
  pay: PagamentoAsaas,
): Promise<ResultadoPersistencia> {
  const { data: atual } = await sb
    .from('cobrancas').select('id, pago_em, status')
    .eq('asaas_charge_id', efeito.chargeId).maybeSingle();

  const confirmaPagamento = efeito.tipo === 'pagamento_confirmado';
  const eventoDePagamento = confirmaPagamento || efeito.tipo === 'estorno';

  if (!atual) {
    const { error } = await sb.from('cobrancas').insert({
      assinatura_id: assinaturaId,
      asaas_charge_id: efeito.chargeId,
      status: pay.status ?? 'DESCONHECIDO',
      valor_centavos: Math.round((pay.value ?? 0) * 100),
      vencimento: pay.dueDate ?? ymdBrt(),
      link_fatura: pay.invoiceUrl ?? null,
      pago_em: confirmaPagamento ? (pay.paymentDate ?? ymdBrt()) : null,
    });
    // 23505 = a linha nasceu entre o SELECT e o INSERT (dois eventos
    // simultaneos). Cair para o caminho de update em vez de perder o evento.
    if (error && error.code !== '23505') return { ok: false, error: error.message };
    if (!error) return { ok: true, acao: 'inserida' };
  }

  // UPDATE parcial: o que nao entrar aqui fica INTOCADO no banco.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (pay.invoiceUrl) patch.link_fatura = pay.invoiceUrl;
  if (typeof pay.value === 'number') patch.valor_centavos = Math.round(pay.value * 100);
  if (pay.dueDate) patch.vencimento = pay.dueDate;

  // O status so regride se o evento for mesmo sobre pagamento: um
  // PAYMENT_CREATED reentregue depois do PAYMENT_RECEIVED nao devolve uma
  // cobranca paga para PENDING.
  const jaPaga = Boolean(atual?.pago_em);

  // ESTORNO E TERMINAL, simetrico a guarda de "ja paga" acima dela. O evento
  // que o Asaas mais reentrega e justamente PAYMENT_RECEIVED — e antes desta
  // guarda ele encontrava `eventoDePagamento = true`, reescrevia `status` de
  // volta para RECEIVED e ressuscitava uma cobranca ja devolvida. So o
  // proprio evento de estorno (reentregue ou nao) pode gravar em cima de uma
  // linha ja estornada; qualquer outro evento — inclusive um novo pagamento
  // reentregue — fica fora do patch, `status` e `pago_em` intocados.
  //
  // Valores crus do Asaas que representam estorno: REFUNDED (total) e
  // REFUND_REQUESTED (parcial/em andamento) — os dois classificados como
  // tipo 'estorno' por `efeitoDoStatusCobranca` em eventos.ts, a mesma
  // traducao usada pelo caminho de sincronizacao deste arquivo.
  const jaEstornada = atual?.status === 'REFUNDED' || atual?.status === 'REFUND_REQUESTED';

  if (!jaEstornada || efeito.tipo === 'estorno') {
    if (!jaPaga || eventoDePagamento) patch.status = pay.status ?? 'DESCONHECIDO';

    // `pago_em` so e ESCRITO na confirmacao. Nos demais eventos ele fica fora
    // do patch e portanto preservado — que era a intencao original e o
    // upsert nao entregava.
    if (confirmaPagamento) patch.pago_em = pay.paymentDate ?? ymdBrt();
  }

  const { error } = await sb.from('cobrancas')
    .update(patch).eq('asaas_charge_id', efeito.chargeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, acao: 'atualizada' };
}

/** Uma cobranca como o Asaas devolve em `GET /subscriptions/{id}/payments`. */
export type CobrancaRemota = PagamentoAsaas & { id: string; subscription?: string };

/**
 * Traz para o banco as cobrancas que o Asaas ja tem.
 *
 * EXISTE PORQUE `cobrancas` NASCEU 100% DEPENDENTE DO WEBHOOK. O Asaas emite
 * a primeira fatura no mesmo instante em que a assinatura e criada, mas o
 * app so ficava sabendo se o POST dele chegasse — e ele nao alcanca
 * `localhost`, nao atravessa firewall e pode falhar em producao. O titular
 * contratava, via "a cobranca aparecera aqui em instantes" e ficava com a
 * tela vazia, sem link para pagar. Achado no smoke manual de 27/07.
 *
 * Recebe a lista JA BUSCADA em vez de chamar o Asaas: o cron ja tem esses
 * dados em maos (uma chamada, nao duas) e a funcao fica testavel sem rede.
 *
 * Nao lanca: sincronizar e conveniencia. Falhar aqui nao pode desfazer uma
 * contratacao que ja deu certo do outro lado.
 */
export async function sincronizarCobrancas(
  sb: SupabaseClient,
  assinaturaId: string,
  pagamentos: CobrancaRemota[],
): Promise<{ gravadas: number; erros: number }> {
  let gravadas = 0;
  let erros = 0;
  for (const p of pagamentos) {
    if (!p?.id) continue;
    try {
      const r = await persistirCobranca(
        sb, assinaturaId,
        { tipo: efeitoDoStatusCobranca(p.status), chargeId: p.id, subscriptionId: p.subscription ?? null },
        p,
      );
      if (r.ok) gravadas++;
      else { erros++; console.error('[billing sync] cobranca nao gravada', p.id, r.error); }
    } catch (err) {
      erros++;
      console.error('[billing sync] excecao ao gravar cobranca', p.id, err);
    }
  }
  return { gravadas, erros };
}
