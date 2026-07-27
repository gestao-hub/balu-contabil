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

export type ActionResult = { ok: true } | { ok: false; error: string };

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
