// Abre uma notificação no contexto da empresa certa.
//
// MOTIVO: `notifications.company_id` sempre existiu, mas o `action_href` gravado
// pela RPC é uma rota crua (`/impostos`) — e /impostos renderiza para a empresa
// ATIVA, não para a do aviso. Quem tem mais de uma empresa clicava em "Abrir" num
// aviso da empresa A e caía na página da empresa B, que podia estar em dia: o
// aviso dizia "pendente" e a tela dizia "entregue". Aqui a empresa ativa passa a
// ser a do aviso antes do redirect, e o link que aponta pra cá diz o nome dela.
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * `action_href` vem do banco. Só rota interna passa: uma barra, nunca duas
 * (`//evil.com` é URL absoluta protocol-relative) e nada de esquema.
 */
function rotaInterna(href: string | null): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origem = new URL(req.url).origin;
  const irPara = (destino: string) => NextResponse.redirect(new URL(destino, origem));

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return irPara('/login');

  // A RLS `notifications_select_own` já restringe a owner_user_id = auth.uid():
  // id de outro usuário volta vazio e cai na lista, sem revelar que existe.
  const { data: n } = await supabase
    .from('notifications')
    .select('id, company_id, action_href, lida_em')
    .eq('id', id)
    .maybeSingle();
  if (!n) return irPara('/notificacoes');

  if (!n.lida_em) {
    await supabase.from('notifications').update({ lida_em: new Date().toISOString() }).eq('id', id);
  }

  if (n.company_id) {
    // Troca a empresa ativa só se o usuário enxerga a empresa — quem decide é a
    // RLS de `companies`. Sem esta checagem, uma linha adulterada apontaria o
    // current_company para uma empresa alheia.
    const { data: empresa } = await supabase
      .from('companies')
      .select('id')
      .eq('id', n.company_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (empresa) {
      await supabase.from('profiles').update({ current_company: n.company_id }).eq('user_id', user.id);
    }
  }

  return irPara(rotaInterna(n.action_href) ?? '/notificacoes');
}
