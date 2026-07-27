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

export type ActionResult = { ok: true } | { ok: false; error: string };

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
): Promise<ActionResult> {
  if (!assinaturaId || !planoId) return { ok: false, error: 'Dados incompletos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, company_id, contabilidade_id, asaas_customer_id, asaas_subscription_id')
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
  return { ok: true };
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
