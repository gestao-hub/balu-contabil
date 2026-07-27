// @custom — Guard de página do AdminBalu. Segue o padrão inline já usado em
// admin/contabilidades (role_types.type === 'AdminBalu' é a fonte canônica),
// extraído para reuso pelas telas de oversight (/admin, /admin/empresas,
// /admin/usuarios). Redireciona em vez de retornar erro porque é usado no topo
// de Server Components de página.
import 'server-only';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

export async function requireAdminBaluPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: roleRow } = await supabase
    .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
  if (roleRow?.type !== 'AdminBalu') redirect('/');
  return user;
}

/** Guard de AÇÃO do AdminBalu. Diferente do `requireAdminBaluPage`, que
 *  redireciona: aqui devolvemos erro, porque Server Action que redireciona
 *  de dentro perde a mensagem para o usuário.
 *
 *  Nasceu local a `admin/contabilidades/actions.ts` e foi extraído no Bloco
 *  4A, quando a tela de planos passou a precisar do mesmo guard — duplicar
 *  num terceiro arquivo era o caminho para as duas cópias divergirem. */
export async function requireAdminBaluAction(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: role } = await supabase
    .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
  if (role?.type !== 'AdminBalu') return { error: 'Acesso restrito.' };
  return { userId: user.id };
}
