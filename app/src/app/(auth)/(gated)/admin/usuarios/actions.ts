'use server';
// Marcar/desmarcar conta de teste (0113). Só AdminBalu; auditado.
import { revalidatePath } from 'next/cache';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { marcarContaTeste, desmarcarContaTeste } from '@/lib/admin/contas-teste';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function definirContaTesteAction(userId: string, teste: boolean): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!userId) return { ok: false, error: 'Usuário não informado.' };

  const r = teste ? await marcarContaTeste(userId, ctx.userId) : await desmarcarContaTeste(userId);
  if (!r.ok) return r;

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: teste ? 'usuario.conta_teste_marcada' : 'usuario.conta_teste_desmarcada',
    alvoTipo: 'usuario', alvoId: userId,
  });
  revalidatePath('/admin/usuarios');
  revalidatePath('/admin/configuracoes');
  return { ok: true };
}
