// @custom — bubble-behavior: editado à mão, não regenerar.
// Auth gate: sem sessão → /login; sem empresa (current_company vazio) → /onboarding;
// documento LGPD pendente de aceite → /aceite (Task 12).
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import { documentosPendentes } from '@/lib/lgpd/pendencia-aceite';
import MenuLateral, { type EscritorioBranding } from '@/components/MenuLateral';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Gate de re-aceite (LGPD, Task 12): redireciona pra /aceite quando há documento
  // publicado que o usuário ainda não aceitou na versão vigente. `documentosPendentes`
  // é um no-op (retorna []) quando não há documentos publicados. O layout não sabe a
  // rota atual (Server Component), então lê `x-pathname` (setado pelo middleware) pra
  // não redirecionar quando já está em /aceite — evita loop /aceite → /aceite.
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (pathname !== '/aceite') {
    const pendentes = await documentosPendentes(user.id);
    if (pendentes.length > 0) redirect('/aceite');
  }

  const [{ data: profile }, { data: companies }, { data: roleRow }, { data: membro }] = await Promise.all([
    supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle(),
    // contabilidade_id junto — evita 1 query extra pra descobrir se a empresa
    // ativa tem escritório (co-branding, Task 18).
    supabase.from('companies').select('id, nome, contabilidade_id').eq('user_id', user.id).is('deleted_at', null).order('nome'),
    supabase.from('role_types').select('type').eq('user_id', user.id).maybeSingle(),
    supabase.from('contabilidade_membros').select('contabilidade_id').eq('user_id', user.id).maybeSingle(),
  ]);

  // Co-branding (Task 18): só busca a contabilidade quando a empresa ATIVA tem
  // contabilidade_id — sem isso, zero query extra (não pesa no caminho comum).
  // Admin client: empresa não tem RLS de leitura em `contabilidades`.
  let escritorio: EscritorioBranding | null = null;
  const currentCompanyContabilidadeId =
    (companies ?? []).find((c) => c.id === profile?.current_company)?.contabilidade_id ?? null;
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

  // role_types.type é a fonte canônica; metadata como fallback.
  const rawRole = (roleRow?.type as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
  const normalizedRole = rawRole.toLowerCase();
  const userRole: 'empresa' | 'contador' | 'adminbalu' =
    normalizedRole === 'contador' ? 'contador' : normalizedRole === 'adminbalu' ? 'adminbalu' : 'empresa';
  // AdminBalu e contadores recém-cadastrados não têm empresa e não podem ficar
  // presos em /onboarding — AdminBalu não opera empresas; o contador precisa
  // chegar em /contador/cadastro (existe desde a Task 10).
  const needsOnboarding = !profile?.current_company && !['adminbalu', 'contador'].includes(normalizedRole);
  if (needsOnboarding) redirect('/onboarding');

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
        currentCompanyId={profile?.current_company ?? null}
        temEscritorio={!!membro}
        escritorio={escritorio}
      />
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</div>
    </div>
  );
}
