// Bloco 7, Task 12 — consentimento de Open Finance e confirmação de sugestões.
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { registrarAuditoria } from '@/lib/security/audit';
import { conciliacaoDisponivel } from '@/lib/conciliacao/provedor';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function empresaAtiva(): Promise<{ userId: string; companyId: string } | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  return companyId ? { userId: user.id, companyId } : null;
}

/**
 * Conecta a conta bancária (consentimento explícito).
 *
 * LGPD: dado bancário é sensível por consequência. O consentimento é **por
 * empresa**, registrado com data e autor, e revogável a qualquer momento —
 * base legal art. 7º, I. O texto que o usuário aceita mora na tela, não aqui.
 */
export async function conectarContaAction(provedor = 'mock'): Promise<ActionResult> {
  // Fronteira, não enfeite de UI: sem provedor real, conectar não pode
  // acontecer nem por chamada direta da action. A tela só esconde o botão.
  if (!conciliacaoDisponivel()) {
    return { ok: false, error: 'A conexão bancária ainda não está disponível. Avisaremos quando estiver.' };
  }

  const ctx = await empresaAtiva();
  if (!ctx) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const supabase = await createServerClient();
  const { error } = await supabase.from('conciliacao_conexoes').insert({
    company_id: ctx.companyId,
    provedor,
    status: 'ativa',
    consentida_em: new Date().toISOString(),
    criada_por: ctx.userId,
  });

  if (error) {
    // O índice único parcial (0071) garante uma conexão viva por empresa.
    if (error.code === '23505') return { ok: false, error: 'Esta empresa já tem uma conta conectada.' };
    return { ok: false, error: error.message };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'conciliacao.conectar',
    alvoTipo: 'company', alvoId: ctx.companyId,
  });

  revalidatePath('/configuracoes/conciliacao');
  return { ok: true };
}

/**
 * Revoga o consentimento e **apaga as transações importadas**.
 *
 * Apagar é o comportamento certo aqui: o dado bancário só existia por causa do
 * consentimento, e a revogação é o titular dizendo "não quero mais que vocês
 * tenham isso" (LGPD art. 18, VI). A linha da conexão fica, com status
 * `revogada` — é ela que registra que o consentimento existiu e quando acabou.
 */
export async function desconectarContaAction(): Promise<ActionResult> {
  const ctx = await empresaAtiva();
  if (!ctx) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const supabase = await createServerClient();

  // Apagar o extrato importado é o titular exercendo o art. 18, VI da LGPD —
  // e por isso a 0076 abriu DELETE para ele (`conciliacao_transacoes_delete_dono`,
  // com `user_owns_company`), em vez de fazermos isso por service_role. A RLS
  // continua sendo a fronteira: um `company_id` que não seja dele apaga zero
  // linhas, mesmo que `profiles.current_company` diga o contrário.
  //
  // INSERT e UPDATE seguem fechados: extrato é escrito pelo cron, não pela tela.
  const { error: eTx } = await supabase
    .from('conciliacao_transacoes').delete().eq('company_id', ctx.companyId);
  if (eTx) return { ok: false, error: eTx.message };

  const { error } = await supabase
    .from('conciliacao_conexoes')
    .update({ status: 'revogada', updated_at: new Date().toISOString() })
    .eq('company_id', ctx.companyId)
    .in('status', ['pendente', 'ativa']);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'conciliacao.revogar',
    alvoTipo: 'company', alvoId: ctx.companyId,
  });

  revalidatePath('/configuracoes/conciliacao');
  return { ok: true };
}

/**
 * Confirma uma sugestão: é um humano decidindo o que o matcher não teve como
 * decidir sozinho (duas guias do mesmo valor, duas entradas para a mesma guia).
 *
 * Passa pela MESMA RPC da baixa automática e da manual — origem diferente só
 * para a auditoria saber de onde veio.
 */
export async function confirmarSugestaoAction(
  transacaoId: string, guiaId: string,
): Promise<ActionResult> {
  const ctx = await empresaAtiva();
  if (!ctx) return { ok: false, error: 'Nenhuma empresa selecionada.' };
  if (!transacaoId || !guiaId) return { ok: false, error: 'Dados incompletos.' };

  const supabase = await createServerClient();

  // A data do pagamento é a do extrato, não a de hoje: quem paga em 20/02 e
  // confirma em 05/03 pagou em 20/02, e é essa data que vale para juros.
  const { data: tx } = await supabase
    .from('conciliacao_transacoes')
    .select('data,company_id,guia_id')
    .eq('id', transacaoId)
    .maybeSingle();

  if (!tx || tx.company_id !== ctx.companyId) return { ok: false, error: 'Lançamento não encontrado.' };
  if (tx.guia_id) return { ok: false, error: 'Este lançamento já foi conciliado.' };

  const { data: res, error } = await supabase.rpc('registrar_pagamento_guia', {
    p_guia_id: guiaId,
    p_data_pagamento: tx.data as string,
    p_origem: 'conciliacao_confirmada',
    p_transacao_id: transacaoId,
  });

  if (error) return { ok: false, error: error.message };
  const r = res as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) return { ok: false, error: r?.motivo === 'nao_autorizado' ? 'Esta guia não é da sua empresa.' : 'Guia não encontrada.' };

  revalidatePath('/configuracoes/conciliacao');
  revalidatePath('/impostos');
  return { ok: true };
}
