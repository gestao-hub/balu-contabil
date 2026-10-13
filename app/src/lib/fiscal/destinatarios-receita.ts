// Quem recebe os avisos da Receita (Caixa Postal 0110, situação fiscal 0111):
// o dono da empresa e cada membro do escritório que a atende, cada um com o
// link da sua tela. Um lugar só, para os dois avisos nunca divergirem.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function destinatariosReceita(admin: SupabaseClient, companyId: string): Promise<{
  nomeEmpresa: string; destinos: { userId: string; href: string }[];
}> {
  const { data: empresa } = await admin.from('companies')
    .select('user_id, contabilidade_id, nome, razao_social').eq('id', companyId).maybeSingle();
  const nomeEmpresa = ((empresa?.nome as string | null)?.trim() || (empresa?.razao_social as string | null)?.trim()) ?? '';
  const destinos: { userId: string; href: string }[] = [];
  if (empresa?.user_id) destinos.push({ userId: empresa.user_id as string, href: '/receita/mensagens' });
  if (empresa?.contabilidade_id) {
    const { data: membros } = await admin.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', empresa.contabilidade_id as string);
    for (const m of membros ?? []) {
      destinos.push({ userId: m.user_id as string, href: `/contador/clientes/${companyId}/receita` });
    }
  }
  return { nomeEmpresa, destinos };
}
