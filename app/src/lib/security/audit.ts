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

/** Best-effort: nunca lança nem bloqueia a ação principal.
 *
 *  CONSERTO 3 (Bloco 5 produção fiscal, 20/08/2026): o `insert` do supabase-js
 *  devolve `{ error }` em vez de lançar — o `try/catch` abaixo só pega falha
 *  de REDE. Sem conferir `error` explicitamente, um insert que falhasse na
 *  gravação (por exemplo `'1'::uuid` — erro de sintaxe, porque `alvo_id` é
 *  uuid e quatro actions passavam a string `'1'`) era engolido em silêncio:
 *  a função devolvia sucesso e NADA ia para `audit_log`. Confirmado em
 *  produção: nenhuma troca de credencial de config_focus/config_serpro/
 *  config_ia/parametros_fiscais jamais registrou linha, apesar da tela
 *  prometer. A auditoria continua best-effort — não lança —, mas a falha
 *  deixa de ser muda. */
export async function registrarAuditoria(e: EventoAuditoria): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('audit_log').insert({
      actor_user_id: e.actorUserId, acao: e.acao, alvo_tipo: e.alvoTipo ?? null,
      alvo_id: e.alvoId ?? null, contabilidade_id: e.contabilidadeId ?? null,
      meta: e.meta ?? null, ip: e.ip ?? null,
    });
    if (error) {
      console.warn('[auditoria] insert falhou:', e.acao, error.message);
    }
  } catch (err) {
    console.warn('[auditoria] falhou:', err instanceof Error ? err.message : String(err));
  }
}
