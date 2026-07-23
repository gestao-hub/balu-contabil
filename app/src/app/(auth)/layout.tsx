// @custom — bubble-behavior: editado à mão, não regenerar.
// Auth gate: sem sessão → /login. Os gates de aceite LGPD e de onboarding vivem
// no sub-grupo (gated)/layout.tsx — assim /aceite fica fora deles e não há como
// formar loop de redirect (antes o gate dependia do header x-pathname setado por
// middleware, que não chegava nas navegações RSC em produção → loop /aceite→/aceite
// e tela preta pós-login).
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getGateContext } from '@/lib/auth/gate-context';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import MenuLateral, { type EscritorioBranding } from '@/components/MenuLateral';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // user + role + current_company vêm do helper memoizado por request — o mesmo que
  // o (gated)/layout usa, então getUser/profiles/role_types rodam uma vez só.
  const ctx = await getGateContext();
  if (!ctx) redirect('/login');
  const { user, currentCompany, normalizedRole } = ctx;

  const supabase = await createServerClient();
  const [{ data: companies }, { data: membro }] = await Promise.all([
    // contabilidade_id junto — evita 1 query extra pra descobrir se a empresa
    // ativa tem escritório (co-branding, Task 18).
    supabase.from('companies').select('id, nome, contabilidade_id').eq('user_id', user.id).is('deleted_at', null).order('nome'),
    supabase.from('contabilidade_membros').select('contabilidade_id').eq('user_id', user.id).maybeSingle(),
  ]);

  // Co-branding (Task 18): só busca a contabilidade quando a empresa ATIVA tem
  // contabilidade_id — sem isso, zero query extra (não pesa no caminho comum).
  // Admin client: empresa não tem RLS de leitura em `contabilidades`.
  let escritorio: EscritorioBranding | null = null;
  const currentCompanyContabilidadeId =
    (companies ?? []).find((c) => c.id === currentCompany)?.contabilidade_id ?? null;
  if (currentCompanyContabilidadeId) {
    const admin = createAdminClient();
    const { data: contab } = await admin
      .from('contabilidades')
      .select('nome, logo_url, whatsapp_suporte, status')
      .eq('id', currentCompanyContabilidadeId)
      .maybeSingle();
    if (contab?.status === 'aprovada') {
      escritorio = {
        nome: contab.nome as string,
        logoUrl: contab.logo_url ? await signedUrlBranding(contab.logo_url as string) : null,
        whatsapp: (contab.whatsapp_suporte as string | null) ?? null,
      };
    }
  }

  // normalizedRole vem do helper (role_types.type canônico; user_metadata fallback).
  const userRole: 'empresa' | 'contador' | 'adminbalu' =
    normalizedRole === 'contador' ? 'contador' : normalizedRole === 'adminbalu' ? 'adminbalu' : 'empresa';

  // Layout SaaS: sidebar fixa no viewport, área principal com scroll próprio.
  // `h-screen overflow-hidden` no wrapper trava a página em 100vh; o `<main>`
  // de cada rota fica em um `overflow-y-auto` próprio, e o scrollbar aparece
  // ao lado do conteúdo (sem mover a sidebar).
  return (
    <div className="h-screen flex overflow-hidden">
      <MenuLateral
        userName={
          ((user.user_metadata?.full_name as string | null)?.trim()) ||
          user.email ||
          'Usuário'
        }
        userRole={userRole}
        companies={(companies ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
        currentCompanyId={currentCompany}
        temEscritorio={!!membro}
        escritorio={escritorio}
      />
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</div>
    </div>
  );
}
