'use server';
// Bloco 4A — cancelamento da assinatura.
//
// CDC art. 39: cancelar e UM CLIQUE, nunca um contato com suporte, nunca
// uma tela de retencao que esconda o botao.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaas } from '@/lib/clients';
import { criarAssinaturaNoAsaas } from '@/lib/billing/assinar';
import { reconciliarAssinatura } from '@/lib/billing/reconciliar';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Contratar devolve a fatura junto: sem um link na mao o titular termina o
 *  fluxo sem saber por onde pagar — foi o que o smoke de 27/07 mostrou. */
export type ResultadoContratar =
  | { ok: true; faturaUrl: string | null }
  | { ok: false; error: string };

/**
 * Contrata o plano. É a saída do gate: sem esta action o trial acaba e o
 * titular fica bloqueado sem nada a fazer.
 *
 * A leitura da assinatura passa pela SESSÃO — a policy
 * assinaturas_select_titular é o anti-IDOR, então quem não é titular não
 * enxerga a linha e não chega aqui.
 */
export async function assinarPlanoAction(
  assinaturaId: string, planoId: string,
): Promise<ResultadoContratar> {
  if (!assinaturaId || !planoId) return { ok: false, error: 'Dados incompletos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, company_id, contabilidade_id, asaas_customer_id, asaas_subscription_id, trial_termina_em')
    .eq('id', assinaturaId).maybeSingle();
  if (!a) return { ok: false, error: 'Assinatura não encontrada.' };
  if (a.asaas_subscription_id) return { ok: false, error: 'Já existe uma assinatura ativa.' };
  if (a.status === 'cortesia') {
    return { ok: false, error: 'Esta conta é cortesia e não precisa de assinatura.' };
  }

  const admin = createAdminClient();

  const { data: plano } = await admin
    .from('planos').select('id, nome, valor_centavos, ciclo, publico, ativo')
    .eq('id', planoId).maybeSingle();
  if (!plano || !plano.ativo) return { ok: false, error: 'Plano indisponível.' };

  // O público do plano tem de casar com o tipo do titular: sem isto um
  // empresário poderia contratar o plano de escritório, que é mais barato
  // por cliente e não faz sentido para ele.
  const publicoEsperado = a.contabilidade_id ? 'escritorio' : 'empresa';
  if (plano.publico !== publicoEsperado) {
    return { ok: false, error: 'Este plano não se aplica à sua conta.' };
  }

  // Dados de cobrança do titular. CNPJ é obrigatório no Asaas.
  let nome = '';
  let cpfCnpj = '';
  if (a.company_id) {
    const { data: c } = await admin.from('companies')
      .select('razao_social, nome, cnpj, email').eq('id', a.company_id).maybeSingle();
    nome = (c?.razao_social || c?.nome || '') as string;
    cpfCnpj = (c?.cnpj ?? '') as string;
  } else if (a.contabilidade_id) {
    const { data: ct } = await admin.from('contabilidades')
      .select('nome, cnpj').eq('id', a.contabilidade_id).maybeSingle();
    nome = (ct?.nome ?? '') as string;
    cpfCnpj = (ct?.cnpj ?? '') as string;
  }
  if (!cpfCnpj) {
    return { ok: false, error: 'Cadastre o CNPJ nas configurações antes de assinar.' };
  }
  if (!nome) return { ok: false, error: 'Cadastre a razão social antes de assinar.' };

  const r = await criarAssinaturaNoAsaas(
    {
      assinaturaId: a.id, nome, cpfCnpj,
      email: user.email ?? null,
      asaasCustomerId: a.asaas_customer_id,
      statusAtual: a.status as string,
    },
    {
      id: plano.id, nome: plano.nome,
      valor_centavos: plano.valor_centavos,
      ciclo: plano.ciclo as 'MONTHLY' | 'YEARLY',
    },
  );
  if (!r.ok) return r;

  await registrarAuditoria({
    actorUserId: user.id, acao: 'assinatura.contratar',
    alvoTipo: 'assinatura', alvoId: a.id, meta: { plano_id: plano.id },
  });

  revalidatePath('/conta/assinatura');
  revalidatePath('/contador/assinatura');
  return { ok: true, faturaUrl: r.faturaUrl };
}

/**
 * Troca o plano de uma assinatura já contratada.
 *
 * Atualiza o valor no Asaas ANTES de gravar aqui: gravar primeiro e falhar
 * lá deixaria a tela mostrando um plano que a cobrança não reflete.
 */
export async function trocarPlanoAction(
  assinaturaId: string, planoId: string,
): Promise<ActionResult> {
  if (!assinaturaId || !planoId) return { ok: false, error: 'Dados incompletos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, plano_id, company_id, contabilidade_id, asaas_subscription_id')
    .eq('id', assinaturaId).maybeSingle();
  if (!a) return { ok: false, error: 'Assinatura não encontrada.' };
  if (!a.asaas_subscription_id) {
    return { ok: false, error: 'Não há assinatura ativa para trocar. Use "Assinar plano".' };
  }
  if (a.plano_id === planoId) return { ok: true };   // idempotente

  const admin = createAdminClient();
  const { data: plano } = await admin
    .from('planos').select('id, nome, valor_centavos, publico, ativo')
    .eq('id', planoId).maybeSingle();
  if (!plano || !plano.ativo) return { ok: false, error: 'Plano indisponível.' };

  const publicoEsperado = a.contabilidade_id ? 'escritorio' : 'empresa';
  if (plano.publico !== publicoEsperado) {
    return { ok: false, error: 'Este plano não se aplica à sua conta.' };
  }

  try {
    await asaas.atualizarAssinatura(a.asaas_subscription_id, {
      value: plano.valor_centavos / 100,
      description: `Balu — ${plano.nome}`,
    });
  } catch (err) {
    console.error('[assinatura] falha ao trocar plano no Asaas', err);
    return { ok: false, error: 'Não foi possível trocar o plano agora. Tente novamente.' };
  }

  const { error } = await admin.from('assinaturas')
    .update({ plano_id: plano.id, updated_at: new Date().toISOString() })
    .eq('id', a.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: user.id, acao: 'assinatura.trocar_plano',
    alvoTipo: 'assinatura', alvoId: a.id,
    meta: { de: a.plano_id, para: plano.id },
  });

  revalidatePath('/conta/assinatura');
  revalidatePath('/contador/assinatura');
  return { ok: true };
}

/**
 * Pergunta ao Asaas se a cobrança já foi paga e atualiza o que for preciso.
 *
 * A tela chama isto sozinha depois que o titular abre a fatura — ele pagou
 * em outra aba e não deve precisar recarregar nada para ver "Ativa". O
 * webhook continua sendo a via normal; esta é a que funciona quando ele
 * demora, se perde ou (em desenvolvimento) não alcança o localhost.
 *
 * Devolve o status EFETIVO já reconciliado, para o cliente decidir se
 * precisa pedir um refresh à árvore do servidor.
 */
export async function verificarPagamentoAction(
  assinaturaId: string,
): Promise<{ ok: true; status: string; mudou: boolean } | { ok: false; error: string }> {
  if (!assinaturaId) return { ok: false, error: 'ID ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Leitura pela SESSÃO: a policy assinaturas_select_titular é o anti-IDOR,
  // então quem não é titular não enxerga a linha e não consulta o Asaas por
  // conta de outro.
  const { data: a } = await supabase
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .eq('id', assinaturaId).maybeSingle();
  if (!a) return { ok: false, error: 'Assinatura não encontrada.' };

  // 'cancelada' e 'cortesia' não se reconciliam: a primeira é decisão do
  // titular, a segunda não tem cobrança.
  if (a.status === 'cancelada' || a.status === 'cortesia' || !a.asaas_subscription_id) {
    return { ok: true, status: a.status, mudou: false };
  }

  try {
    const r = await reconciliarAssinatura(createAdminClient(), {
      id: a.id, status: a.status, asaas_subscription_id: a.asaas_subscription_id,
    });
    if (r.mudou || r.cobrancasGravadas > 0) {
      revalidatePath('/conta/assinatura');
      revalidatePath('/contador/assinatura');
    }
    return { ok: true, status: r.status, mudou: r.mudou || r.cobrancasGravadas > 0 };
  } catch (err) {
    // Falhar aqui é silêncio de propósito: é uma consulta de conveniência
    // rodando em laço. Um erro do Asaas não pode virar alerta na tela de
    // quem está só esperando a confirmação.
    console.error('[billing verificar] falhou', err);
    return { ok: false, error: 'Não foi possível verificar agora.' };
  }
}

export async function cancelarAssinaturaAction(assinaturaId: string): Promise<ActionResult> {
  if (!assinaturaId) return { ok: false, error: 'ID ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // A leitura passa pela SESSAO de proposito: a policy
  // assinaturas_select_titular (0050) ja garante que so o titular enxerga a
  // linha, entao o anti-IDOR vem da RLS e nao de uma checagem manual que
  // poderia divergir dela.
  const { data: assinatura } = await supabase
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .eq('id', assinaturaId).maybeSingle();
  if (!assinatura) return { ok: false, error: 'Assinatura não encontrada.' };

  if (assinatura.status === 'cancelada') return { ok: true };  // idempotente
  if (assinatura.status === 'cortesia') {
    return { ok: false, error: 'Esta conta é cortesia e não possui cobrança para cancelar.' };
  }

  // Cancela no Asaas ANTES de marcar aqui: marcar primeiro e falhar la
  // deixaria o cliente achando que cancelou enquanto a cobranca segue viva.
  if (assinatura.asaas_subscription_id) {
    try {
      await asaas.cancelarAssinatura(assinatura.asaas_subscription_id);
    } catch (err) {
      console.error('[assinatura] falha ao cancelar no Asaas', err);
      return { ok: false, error: 'Não foi possível cancelar agora. Tente novamente em instantes.' };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.from('assinaturas').update({
    status: 'cancelada',
    // LIMPAR O ID É PARTE DO CANCELAMENTO, não faxina. `cancelarAssinatura`
    // faz DELETE no Asaas: a subscription deixa de existir lá. Guardar o id
    // morto fazia `assinarPlanoAction` recusar com "Já existe uma assinatura
    // ativa" — quem cancelasse nunca mais conseguiria voltar, e cancelar em
    // um clique com re-entrada impossível é pior que não deixar cancelar.
    asaas_subscription_id: null,
    // O customer FICA: é o cadastro do titular no Asaas, reaproveitado na
    // volta em vez de duplicar.
    cancelada_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', assinatura.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: user.id, acao: 'assinatura.cancelar',
    alvoTipo: 'assinatura', alvoId: assinatura.id,
  });

  revalidatePath('/conta/assinatura');
  revalidatePath('/contador/assinatura');
  return { ok: true };
}
