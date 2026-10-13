// Contas de teste (0113): nunca expiram, não precisam de assinatura e têm tudo
// liberado. A marca é do USUÁRIO; o efeito (assinatura em `cortesia`,
// escritório aprovado) é aplicado no banco por `aplicar_conta_teste`, e as
// triggers da 0113 estendem a marca ao que ele criar depois.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** Ids dos usuários marcados. Falha de leitura = nenhum (só afeta a exibição). */
export async function idsContasTeste(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from('contas_teste').select('user_id');
  if (error) {
    console.error('[contas teste] leitura falhou:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.user_id as string));
}

export async function marcarContaTeste(userId: string, porUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from('contas_teste')
    .upsert({ user_id: userId, marcada_por: porUserId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  const { error: eAplicar } = await admin.rpc('aplicar_conta_teste', { p_user: userId });
  if (eAplicar) return { ok: false, error: eAplicar.message };
  return { ok: true };
}

export async function desmarcarContaTeste(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createAdminClient().rpc('remover_conta_teste', { p_user: userId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
