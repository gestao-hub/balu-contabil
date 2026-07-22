import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type EventoAuditoria = {
  actorUserId: string;
  acao: string;                 // ex.: 'honorario.criar', 'cliente.acessar', 'contabilidade.aprovar'
  alvoTipo?: string;
  alvoId?: string | null;
  contabilidadeId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

/** Best-effort: nunca lança nem bloqueia a ação principal. */
export async function registrarAuditoria(e: EventoAuditoria): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_log').insert({
      actor_user_id: e.actorUserId, acao: e.acao, alvo_tipo: e.alvoTipo ?? null,
      alvo_id: e.alvoId ?? null, contabilidade_id: e.contabilidadeId ?? null,
      meta: e.meta ?? null, ip: e.ip ?? null,
    });
  } catch (err) {
    console.warn('[auditoria] falhou:', err instanceof Error ? err.message : String(err));
  }
}
