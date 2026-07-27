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

export type DadosTitular = {
  assinaturaId: string;
  nome: string;
  cpfCnpj: string;
  email: string | null;
  /** Já existente, se o titular foi criado no Asaas numa tentativa anterior. */
  asaasCustomerId: string | null;
  /** Fim do teste atual (YYYY-MM-DD) — usado para nunca encurtá-lo. */
  trialTerminaEm: string | null;
};

export type ResultadoAssinar =
  | { ok: true; subscriptionId: string }
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

    const venceEm = assinatura.nextDueDate ?? vencimento;

    // NAO vira 'ativa' aqui: quem confirma pagamento e o webhook.
    //
    // Mas o acesso NAO pode continuar bloqueado depois de contratar. Quem
    // assina com o teste ja vencido pagaria um boleto que leva dias a
    // compensar, e ate la seguiria barrado — clicando "Assinar", vendo
    // sucesso e continuando sem poder emitir nota. `trial_termina_em` e
    // justamente o campo "liberado ate" dos status que nao sao 'ativa',
    // entao ele passa a valer ate o primeiro vencimento.
    //
    // Toda saida continua segura: pagou -> webhook poe 'ativa'; nao pagou
    // -> PAYMENT_OVERDUE poe 'inadimplente'; webhook perdido -> o cron
    // reconcilia pelas cobrancas; nada acontece -> statusEfetivo bloqueia
    // sozinho depois do vencimento.
    //
    // Nunca ENCURTA: quem assinou com teste mais longo pela frente mantem
    // o que tinha.
    const trialAtual = titular.trialTerminaEm;
    const novoTrial = trialAtual && trialAtual > venceEm ? trialAtual : venceEm;

    const { error } = await sb.from('assinaturas').update({
      plano_id: plano.id,
      asaas_subscription_id: assinatura.id,
      proxima_cobranca_em: venceEm,
      trial_termina_em: novoTrial,
      updated_at: new Date().toISOString(),
    }).eq('id', titular.assinaturaId);
    if (error) return { ok: false, error: error.message };

    return { ok: true, subscriptionId: assinatura.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[billing assinar] falhou', msg);
    if (/ASAAS_API_KEY/.test(msg)) {
      return { ok: false, error: 'A cobrança ainda não está configurada. Fale com o suporte.' };
    }
    return { ok: false, error: 'Não foi possível concluir a assinatura agora. Tente novamente.' };
  }
}
