// @custom — Visão geral do AdminBalu (oversight da plataforma). Substitui o
// "Início" vazio para o admin (ele não tem empresa/escritório próprios).
import Link from 'next/link';
import { Building2, Briefcase, Users, Clock } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { listarUsuariosPlataforma } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

export default async function AdminVisaoGeralPage() {
  await requireAdminBaluPage();
  const admin = createAdminClient();

  const [{ data: contabs }, { data: comps }, usuarios] = await Promise.all([
    admin.from('contabilidades').select('status'),
    admin.from('companies').select('id, deleted_at'),
    listarUsuariosPlataforma(),
  ]);

  const escritorios = contabs ?? [];
  const pendentes = escritorios.filter((c) => c.status === 'pendente').length;
  const aprovadas = escritorios.filter((c) => c.status === 'aprovada').length;
  const suspensas = escritorios.filter((c) => c.status === 'suspensa').length;

  const empresasAtivas = (comps ?? []).filter((c) => !c.deleted_at).length;
  const empresasTotal = (comps ?? []).length;

  const porPapel = usuarios.reduce<Record<string, number>>((acc, u) => {
    const k = (u.papel ?? 'sem papel').toLowerCase();
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const cards = [
    {
      href: '/admin/contabilidades', Icon: Building2, label: 'Escritórios',
      value: escritorios.length, sub: `${aprovadas} aprovados · ${suspensas} suspensos`,
    },
    {
      href: '/admin/empresas', Icon: Briefcase, label: 'Empresas',
      value: empresasAtivas, sub: `${empresasTotal} no total (inclui arquivadas)`,
    },
    {
      href: '/admin/usuarios', Icon: Users, label: 'Usuários',
      value: usuarios.length,
      sub: Object.entries(porPapel).map(([k, v]) => `${v} ${k}`).join(' · ') || 'nenhum',
    },
  ];

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Visão geral</h1>
        <p className="mt-1 text-sm text-muted-foreground">Painel de administração da plataforma Balu.</p>
      </header>

      {pendentes > 0 && (
        <Link
          href="/admin/contabilidades"
          className="mb-6 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground hover:border-warning"
        >
          <Clock className="size-5 shrink-0 text-warning" />
          <span>
            <b>{pendentes}</b> escritório(s) aguardando aprovação. Clique para revisar.
          </span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ href, Icon, label, value, sub }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4 text-primary" />
              <span className="text-sm">{label}</span>
            </div>
            <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
