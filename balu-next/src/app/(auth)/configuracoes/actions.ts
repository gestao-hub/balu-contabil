// @custom — bubble-behavior: Configurações da empresa (PRD §8)
// Server actions de edição de dados da empresa atual.
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { CompanySchema, type CompanyInput } from '@/types/zod';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateCompanyAction(id: string, patch: Partial<CompanyInput>): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'ID da empresa ausente.' };

  // Validamos via .partial() — todos opcionais para PATCH.
  const parsed = CompanySchema.partial().safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('companies')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/configuracoes');
  revalidatePath('/');
  return { ok: true };
}
