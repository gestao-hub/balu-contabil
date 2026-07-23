// src/app/(auth)/contador/equipe/page.tsx
// Equipe do escritório: mesma guarda de acesso das demais páginas /contador.
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import EquipeClient, { type MembroRow, type ConviteRow } from './EquipeClient';

export default async function ContadorEquipePage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const admin = createAdminClient();
  const contabilidadeId = ctx.contabilidade.id;

  const [{ data: membrosRaw }, { data: convitesRaw }] = await Promise.all([
    admin.from('contabilidade_membros')
      .select('user_id, created_at')
      .eq('contabilidade_id', contabilidadeId)
      .order('created_at', { ascending: true }),
    admin.from('convites')
      .select('id, email, expira_em')
      .eq('contabilidade_id', contabilidadeId)
      .eq('tipo', 'membro')
      .is('usado_em', null)
      .is('revogado_em', null)
      .order('created_at', { ascending: false }),
  ]);

  // Carteiras pequenas — busca sequencial de e-mail/nome via Admin API é aceitável no lançamento.
  const membros: MembroRow[] = [];
  for (const m of membrosRaw ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    membros.push({
      user_id: m.user_id as string,
      email: u?.user?.email ?? null,
      nome: (u?.user?.user_metadata?.full_name as string | null) ?? null,
      created_at: m.created_at as string,
    });
  }

  const agora = Date.now();
  const convites: ConviteRow[] = (convitesRaw ?? [])
    .filter((c) => !c.expira_em || new Date(c.expira_em as string).getTime() > agora)
    .map((c) => ({
      id: c.id as string,
      email: c.email as string,
      expira_em: (c.expira_em as string | null) ?? null,
    }));

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Equipe do escritório</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Convide colegas para acessar a carteira de clientes deste escritório.
        </p>
      </header>

      <EquipeClient membros={membros} convites={convites} currentUserId={ctx.userId} />
    </main>
  );
}
