// src/lib/contador/carteira.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AlvoCarteira = { companyId: string; ownerUserId: string };

/**
 * Guard anti-IDOR: a empresa precisa estar na carteira do escritório.
 * Devolve null tanto para "não existe" quanto para "existe mas é de outro
 * escritório" — o caller responde 403 genérico, sem revelar a diferença.
 */
export async function companyDaCarteira(
  admin: SupabaseClient,
  contabilidadeId: string,
  companyId: string,
): Promise<AlvoCarteira | null> {
  const { data } = await admin
    .from('companies').select('id, user_id, contabilidade_id').eq('id', companyId).maybeSingle();
  const c = data as { id: string; user_id: string | null; contabilidade_id: string | null } | null;
  if (!c || c.contabilidade_id !== contabilidadeId || !c.user_id) return null;
  return { companyId: c.id, ownerUserId: c.user_id };
}
