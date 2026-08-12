// Bloco 7, Task 6 — fila de escaladas de atendimento do escritório.
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marca uma escalada como atendida — é isto que para o relógio do SLA.
 *
 * O escopo por `contabilidade_id` está no `.eq()` E na RLS (policy
 * `whatsapp_atendimentos_update_escritorio`, migration 0070). O `.eq()` sozinho
 * seria anti-IDOR de fachada; a RLS é a fronteira de verdade, e o `.eq()`
 * existe para o erro ser "não encontrado" em vez de um update silencioso de
 * zero linhas.
 */
export async function marcarAtendidoAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'Atendimento não informado.' };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('whatsapp_atendimentos')
    .update({ atendido_em: new Date().toISOString(), atendido_por: g.userId })
    .eq('id', id)
    .eq('contabilidade_id', g.contabilidade.id)
    .is('atendido_em', null)   // idempotente: quem já foi atendido não muda de dono
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    // Duas causas possíveis, e nenhuma é erro do usuário: outra pessoa do
    // escritório atendeu primeiro, ou a linha não é desta contabilidade.
    return { ok: false, error: 'Este atendimento já foi marcado por alguém da equipe.' };
  }

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'atendimento.marcar_atendido',
    contabilidadeId: g.contabilidade.id, alvoTipo: 'whatsapp_atendimento', alvoId: id,
  });

  revalidatePath('/contador/atendimentos');
  return { ok: true };
}
