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
