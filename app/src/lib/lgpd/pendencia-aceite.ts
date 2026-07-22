import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
/** Retorna os tipos ('termos'|'privacidade') cuja versão publicada mais recente
 *  o usuário ainda NÃO aceitou. Vazio = tudo em dia (inclui o caso sem docs publicados). */
export async function documentosPendentes(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: docs } = await admin.from('documento_versoes')
    .select('tipo, versao, publicado_em').not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });
  const vigentes = new Map<string, string>();
  for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao);
  const { data: aceites } = await admin.from('aceites').select('tipo, versao').eq('user_id', userId);
  const aceitou = new Set((aceites ?? []).map((a) => `${a.tipo}:${a.versao}`));
  return [...vigentes].filter(([tipo, versao]) => !aceitou.has(`${tipo}:${versao}`)).map(([t]) => t);
}

/** Gate de re-aceite para AÇÕES DE ESCRITA sensíveis (o layout só cobre navegação
 *  de página; server actions e route handlers não passam pelo layout). Retorna erro
 *  quando há termos/política novos pendentes. NUNCA usar em ações de direito do titular
 *  (exportar/excluir dados) — bloquear o exercício de direito LGPD seria o oposto do
 *  que a lei exige. */
export async function assertAceitesEmDia(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pend = await documentosPendentes(userId);
  if (pend.length > 0) {
    return { ok: false, error: 'Aceite os novos termos e a política de privacidade para continuar.' };
  }
  return { ok: true };
}
