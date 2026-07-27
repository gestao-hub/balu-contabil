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
import type { EfeitoEvento } from './eventos';

export type PagamentoAsaas = {
  value?: number; dueDate?: string; status?: string;
  invoiceUrl?: string; paymentDate?: string;
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
    .from('cobrancas').select('id, pago_em')
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
  if (!jaPaga || eventoDePagamento) patch.status = pay.status ?? 'DESCONHECIDO';

  // `pago_em` so e ESCRITO na confirmacao. Nos demais eventos ele fica fora
  // do patch e portanto preservado — que era a intencao original e o
  // upsert nao entregava.
  if (confirmaPagamento) patch.pago_em = pay.paymentDate ?? ymdBrt();

  const { error } = await sb.from('cobrancas')
    .update(patch).eq('asaas_charge_id', efeito.chargeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, acao: 'atualizada' };
}
