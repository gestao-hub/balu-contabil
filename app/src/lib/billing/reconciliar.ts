// Bloco 4A — reconciliacao de UMA assinatura contra o Asaas.
//
// EXTRAIDA DO CRON PARA SER CHAMAVEL SOB DEMANDA. O webhook e a via normal,
// mas ele nao pode ser a UNICA: nao alcanca localhost, nao atravessa
// firewall, chega atrasado e as vezes nao chega. Enquanto o titular esta
// olhando a tela depois de pagar, perguntar ao Asaas custa uma chamada e
// vale mais que qualquer promessa de "em instantes".
//
// Usada em tres lugares, com a MESMA regra — se cada um decidisse por si,
// a tela e o cron acabariam discordando sobre quem esta em dia:
//   1. cron diario (rede de seguranca)
//   2. acao de verificar pagamento (tela aberta, pos-pagamento)
//   3. — o webhook segue com caminho proprio, por evento
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asaas } from '@/lib/clients';
import { sincronizarCobrancas, type CobrancaRemota } from './cobranca';

export type AssinaturaReconciliavel = {
  id: string;
  status: string;
  asaas_subscription_id: string | null;
};

export type ResultadoReconciliacao = {
  /** Status depois da reconciliacao — igual ao anterior quando nada mudou. */
  status: string;
  mudou: boolean;
  cobrancasGravadas: number;
};

/**
 * Reconcilia PELAS COBRANCAS, nunca pelo status da subscription.
 *
 * O Asaas mantem a subscription 'ACTIVE' enquanto uma cobranca esta vencida
 * — sao coisas diferentes. Uma versao anterior promovia `ACTIVE` para
 * 'ativa', o que desfazia todo PAYMENT_OVERDUE na madrugada seguinte e
 * tornava o gate inoperante.
 *
 * 'cancelada' e 'cortesia' ficam de fora pelo chamador: a primeira e democao
 * deliberada do titular e nenhuma cobranca do passado a ressuscita; a
 * segunda nao tem cobranca nenhuma.
 */
export async function reconciliarAssinatura(
  sb: SupabaseClient,
  a: AssinaturaReconciliavel,
): Promise<ResultadoReconciliacao> {
  const inalterado = { status: a.status, mudou: false, cobrancasGravadas: 0 };
  if (!a.asaas_subscription_id) return inalterado;

  const { data: pagamentos } = await asaas.listarCobrancas(a.asaas_subscription_id);
  if (!pagamentos?.length) return inalterado;

  const { gravadas } = await sincronizarCobrancas(sb, a.id, pagamentos as CobrancaRemota[]);

  // A cobranca mais recente por vencimento manda: e ela que diz se o
  // titular esta em dia hoje.
  const recente = [...pagamentos].sort((x, y) => (x.dueDate < y.dueDate ? 1 : -1))[0];
  const pago = recente.status === 'RECEIVED' || recente.status === 'CONFIRMED';
  const vencido = recente.status === 'OVERDUE';

  const alvo = pago ? 'ativa' : vencido ? 'inadimplente' : null;
  if (!alvo || alvo === a.status) {
    return { status: a.status, mudou: false, cobrancasGravadas: gravadas };
  }

  const { error } = await sb.from('assinaturas')
    .update({ status: alvo, updated_at: new Date().toISOString() }).eq('id', a.id);
  if (error) return { status: a.status, mudou: false, cobrancasGravadas: gravadas };

  return { status: alvo, mudou: true, cobrancasGravadas: gravadas };
}
