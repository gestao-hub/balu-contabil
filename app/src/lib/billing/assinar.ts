// Bloco 4A — criacao da assinatura no Asaas.
//
// EXISTE PORQUE O GATE PRECISA DE UMA SAIDA: sem este caminho, o trial
// acaba no dia 8, as 22 actions comerciais barram e a unica coisa na tela
// e "cancelar". Um gate sem checkout nao e cobranca, e beco.
//
// Mora em lib/ e nao no arquivo 'use server' porque nao e Server Action:
// e chamada por uma, e todo export de arquivo 'use server' precisa ser
// action serializavel.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaas } from '@/lib/clients';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { sincronizarCobrancas, type CobrancaRemota } from './cobranca';

export type DadosTitular = {
  assinaturaId: string;
  nome: string;
  cpfCnpj: string;
  email: string | null;
  /** Já existente, se o titular foi criado no Asaas numa tentativa anterior. */
  asaasCustomerId: string | null;
};

export type ResultadoAssinar =
  | { ok: true; subscriptionId: string; faturaUrl: string | null }
  | { ok: false; error: string };

/** Dias até o primeiro vencimento. Também é a janela de acesso liberado
 *  entre contratar e o boleto ser pago (ver `criarAssinaturaNoAsaas`). */
export const DIAS_ATE_PRIMEIRO_VENCIMENTO = 3;

/**
 * Primeiro vencimento: `hoje` (em BRT) + `dias`, como data civil.
 *
 * Exportada para teste: a aritmética de data com fuso é onde o Bloco A e o
 * Bloco 3 já erraram, e aqui um dia a menos vira cobrança antes da hora.
 * Trabalha só com string YYYY-MM-DD para não depender do fuso do runtime
 * (na Vercel é UTC, na máquina do dev é BRT).
 */
export function primeiroVencimento(
  hoje: string = ymdBrt(), dias: number = DIAS_ATE_PRIMEIRO_VENCIMENTO,
): string {
  const t = Date.parse(`${hoje}T00:00:00Z`) + dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export async function criarAssinaturaNoAsaas(
  titular: DadosTitular,
  plano: { id: string; valor_centavos: number; ciclo: 'MONTHLY' | 'YEARLY'; nome: string },
): Promise<ResultadoAssinar> {
  const sb = createAdminClient();

  let customerId = titular.asaasCustomerId;
  try {
    // Reusa o customer de uma tentativa anterior: criar de novo geraria
    // cadastro duplicado no Asaas a cada clique que falhasse adiante.
    if (!customerId) {
      const cliente = await asaas.criarCliente({
        name: titular.nome,
        cpfCnpj: titular.cpfCnpj,
        email: titular.email ?? undefined,
      });
      customerId = cliente.id;
      // Persiste ANTES de criar a assinatura: se o passo seguinte falhar,
      // o proximo clique reaproveita este customer em vez de duplicar.
      await sb.from('assinaturas')
        .update({ asaas_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('id', titular.assinaturaId);
    }

    const vencimento = primeiroVencimento();
    const assinatura = await asaas.criarAssinatura({
      customer: customerId,
      billingType: 'UNDEFINED',   // o cliente escolhe boleto/Pix/cartao na fatura
      value: plano.valor_centavos / 100,
      nextDueDate: vencimento,
      cycle: plano.ciclo,
      description: `Balu — ${plano.nome}`,
    });

    // ⚠️ NAO usar `assinatura.nextDueDate` da resposta. Medido contra o
    // sandbox em 2026-07-27: pedindo nextDueDate=2026-07-30, o Asaas cria a
    // primeira cobranca vencendo em 30/07 e DEVOLVE nextDueDate=2026-08-30
    // — o vencimento do ciclo SEGUINTE. Usa-lo como "liberado ate" daria um
    // mes inteiro de acesso a quem nao pagasse o primeiro boleto, e a tela
    // anunciaria "proxima cobranca em 30/08" com um boleto vencendo em
    // 30/07. O que vale e a data que NOS pedimos.
    const venceEm = vencimento;

    // CONTRATAR NAO LIBERA NADA. Decisao de produto de 27/07: o acesso volta
    // quando o PAGAMENTO e reconhecido, nunca no clique.
    //
    // Por isso NEM o status NEM `trial_termina_em` sao tocados aqui:
    //   · quem estava em teste vigente segue no teste que ja tinha (e o
    //     prazo dele, nao uma promessa de pagamento — nao encurta nem
    //     estende);
    //   · quem estava bloqueado CONTINUA bloqueado ate o Asaas confirmar.
    //
    // Uma versao anterior empurrava `trial_termina_em` para o primeiro
    // vencimento e o status para 'trial', dando ~3 dias de acesso a quem so
    // tinha clicado. Isso e credito, nao assinatura: quem nao pagasse o
    // boleto teria usado o mes inteiro de graca a cada nova contratacao.
    //
    // Quem libera: PAYMENT_RECEIVED/CONFIRMED -> 'ativa', pelo webhook ou
    // pela reconciliacao (lib/billing/reconciliar.ts), que a propria tela
    // dispara enquanto o titular espera. Com Pix ou cartao isso leva
    // segundos; com boleto, o tempo da compensacao.
    const { error } = await sb.from('assinaturas').update({
      plano_id: plano.id,
      asaas_subscription_id: assinatura.id,
      proxima_cobranca_em: venceEm,
      updated_at: new Date().toISOString(),
    }).eq('id', titular.assinaturaId);
    if (error) return { ok: false, error: error.message };

    // A primeira fatura JA EXISTE no Asaas neste ponto — ele a emite junto
    // com a assinatura. Puxar agora, em vez de esperar o webhook, e o que
    // faz a tela ter um link de pagamento no mesmo segundo. Best effort de
    // proposito: a contratacao ja deu certo do outro lado, e falhar aqui nao
    // pode transforma-la em erro para o titular.
    let faturaUrl: string | null = null;
    try {
      const { data: pagamentos } = await asaas.listarCobrancas(assinatura.id);
      await sincronizarCobrancas(sb, titular.assinaturaId, (pagamentos ?? []) as CobrancaRemota[]);
      faturaUrl = [...(pagamentos ?? [])]
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
        .find((p) => p.invoiceUrl)?.invoiceUrl ?? null;
    } catch (e) {
      console.error('[billing assinar] cobrancas nao sincronizadas', e);
    }

    return { ok: true, subscriptionId: assinatura.id, faturaUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[billing assinar] falhou', msg);
    // O nome da variavel mudou para TOKEN_ASAAS_SANDBOX/PRODUCAO e este
    // teste continuou procurando ASAAS_API_KEY — que nao existe mais em
    // lugar nenhum. Resultado: token ausente caia no "Tente novamente",
    // mandando o titular repetir um clique que nunca ia funcionar. Foi
    // exatamente o que escondeu o bug do `$` nao escapado no .env.local.
    if (/TOKEN_ASAAS_\w+ nao configurado/.test(msg)) {
      return { ok: false, error: 'A cobrança ainda não está configurada. Fale com o suporte.' };
    }
    return { ok: false, error: 'Não foi possível concluir a assinatura agora. Tente novamente.' };
  }
}
