// src/app/(auth)/contador/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { ContabilidadeSchema } from '@/types/zod';

// Padrão local ao arquivo (não cross-import de rota) — segue a convenção
// dominante do repo: cada `actions.ts` declara seu próprio ActionResult
// (ver onboarding/actions.ts, impostos/actions.ts, conta/actions.ts,
// configuracoes/actions.ts). `clientes/actions.ts` é o único que exporta o
// tipo, e mesmo assim ninguém mais importa cross-rota — só reusa localmente.
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export async function criarContabilidadeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };
  const parsed = ContabilidadeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const admin = createAdminClient();
  // 1 usuário = 1 contabilidade no lançamento
  const { data: jaMembro } = await admin.from('contabilidade_membros')
    .select('contabilidade_id').eq('user_id', user.id).maybeSingle();
  if (jaMembro) return { ok: false, error: 'Você já faz parte de um escritório.' };

  const { data: cont, error } = await admin.from('contabilidades')
    .insert({ ...parsed.data, status: 'pendente' }).select('id').single();
  if (error) return { ok: false, error: error.message };
  const { error: e2 } = await admin.from('contabilidade_membros')
    .insert({ contabilidade_id: cont.id, user_id: user.id });
  if (e2) return { ok: false, error: e2.message };
  revalidatePath('/contador');
  return { ok: true, data: { id: cont.id } };
}

export async function removerClienteDaCarteiraAction(companyId: string): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g || !g.contabilidade) return { ok: false, error: 'Sem escritório.' };
  const admin = createAdminClient();
  const { error } = await admin.from('companies')
    .update({ contabilidade_id: null })
    .eq('id', companyId).eq('contabilidade_id', g.contabilidade.id); // escopado (anti-IDOR)
  revalidatePath('/contador');
  return error ? { ok: false, error: error.message } : { ok: true };
}
