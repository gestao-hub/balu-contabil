// src/app/(auth)/(gated)/contador/sla-actions.ts
// SLA de atendimento do escritório (Bloco 7, Frente 2).
//
// Este arquivo é o que sobrou de `dominio-actions.ts` depois que a
// funcionalidade de domínio próprio foi arquivada em 12/08/2026 — o SLA ficou
// porque é do pilar 8 e foi pedido pelo cliente; o domínio saiu porque não
// foi. Ver `docs/arquivo/2026-08-12-dominio-proprio-README.md`.
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Prazo de resposta em horas CORRIDAS (decisão §2.4 da spec do Bloco 7 — hora
 * útil exigiria calendário de feriados municipais/estaduais). `null` = o
 * escritório não promete prazo: nada é exibido ao cliente e nada é alertado.
 */
export async function salvarSlaAction(horas: number | null): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  if (horas !== null) {
    if (!Number.isInteger(horas) || horas < 1 || horas > 720) {
      return { ok: false, error: 'Informe um prazo entre 1 e 720 horas (30 dias), ou deixe em branco.' };
    }
  }

  // Pela SESSÃO, com a RLS como fronteira — a policy
  // `contabilidades_update_membro` (id = minha_contabilidade_membro()) é quem
  // garante que ninguém mexe no SLA de outro escritório.
  //
  // Isto já esteve quebrado: a 0053 revogou o UPDATE de tabela e reconcedeu
  // por coluna, e `sla_resposta_horas` nasceu na 0069, depois disso — grant
  // por coluna não alcança coluna nova, então o update voltava "permission
  // denied" e a funcionalidade inteira era inerte. A 0076 concedeu a coluna.
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({ sla_resposta_horas: horas })
    .eq('id', g.contabilidade.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'escritorio.sla',
    contabilidadeId: g.contabilidade.id,
  });

  revalidatePath('/contador/configuracoes');
  return { ok: true };
}
