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
};

export type ResultadoAssinar =
  | { ok: true; subscriptionId: string }
  | { ok: false; error: string };

/** Primeiro vencimento: hoje + `dias`. Em BRT, porque o Asaas trata a data
 *  como dia civil e um deslocamento de fuso viraria cobranca um dia antes. */
function primeiroVencimento(dias = 3): string {
  const hoje = ymdBrt();
  const d = new Date(`${hoje}T12:00:00-03:00`);
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
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

    const assinatura = await asaas.criarAssinatura({
      customer: customerId,
      billingType: 'UNDEFINED',   // o cliente escolhe boleto/Pix/cartao na fatura
      value: plano.valor_centavos / 100,
      nextDueDate: primeiroVencimento(),
      cycle: plano.ciclo,
      description: `Balu — ${plano.nome}`,
    });

    const { error } = await sb.from('assinaturas').update({
      plano_id: plano.id,
      asaas_subscription_id: assinatura.id,
      proxima_cobranca_em: assinatura.nextDueDate ?? null,
      // NAO vira 'ativa' aqui: quem confirma pagamento e o webhook. Ate la
      // o titular segue no trial que ja tinha — assinar nao pode ENCURTAR
      // o periodo de teste de quem assinou antes de ele acabar.
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
