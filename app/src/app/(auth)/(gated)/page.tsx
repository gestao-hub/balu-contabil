// @custom — bubble-behavior (Day 1 / PR 1.1 — dashboard, V1 §5.1 + §5.2)
import { redirect } from 'next/navigation';
import { Wallet, CalendarClock, FileText, Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getGateContext } from '@/lib/auth/gate-context';
import DashboardCard from '@/components/DashboardCard';
import PendingActionsList from '@/components/PendingActionsList';
import { getDashboardMetrics, getPendingActions } from '@/lib/dashboard/queries';
import { dataBrt } from '@/lib/format/data-brt';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return dataBrt(iso);
}

function diasAteVenc(dateOnly: string | null): number | null {
  if (!dateOnly) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateOnly}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export default async function DashboardPage() {
  // O (auth)/layout já redireciona sem sessão e força onboarding sem empresa.
  // ctx é o mesmo do layout (React cache), sem query extra.
  const ctx = await getGateContext();
  // AdminBalu não tem empresa própria — sua home é a Visão geral da plataforma.
  if (ctx?.normalizedRole === 'adminbalu') redirect('/admin');

  const companyId = ctx?.currentCompany ?? null;

  // Auditoria 29/08/2026: "o início do Contador mistura linguagem e ação de
  // empresa". A causa é esta tela ser a home de todo mundo: o contador sem
  // empresa própria caía no estado vazio abaixo, que manda "criar ou
  // selecionar uma empresa" — coisa que ele não faz. A home dele é a carteira,
  // exatamente como a do AdminBalu é /admin.
  //
  // A condição olha `companyId`, e não só o papel, de propósito: contador PODE
  // ser dono de uma empresa (papel e posse são coisas diferentes — `role_types`
  // não impede o vínculo em `companies`). Nesse caso o painel abaixo é
  // legítimo e continua aparecendo; redirecionar sempre esconderia dele a
  // própria empresa.
  if (!companyId && ctx?.normalizedRole === 'contador') redirect('/contador');

  if (!companyId) {
    return (
      <main className="p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-head font-semibold text-foreground">Início</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie ou selecione uma empresa para ver seu painel.
          </p>
        </header>
      </main>
    );
  }

  const supabase = await createServerClient();
  const [metrics, pending] = await Promise.all([
    getDashboardMetrics(supabase, companyId),
    getPendingActions(supabase, companyId),
  ]);

  const guia = metrics.proximaGuia;
  const ultima = metrics.ultimaNota;
  const diasGuia = diasAteVenc(guia?.data_vencimento ?? null);

  const guiaTone =
    diasGuia == null ? 'default' : diasGuia < 0 ? 'danger' : diasGuia <= 7 ? 'warning' : 'default';
  const guiaSubtitle = !guia
    ? 'Nenhuma guia em aberto'
    : diasGuia == null
      ? 'Sem vencimento definido'
      : diasGuia < 0
        ? `Venceu há ${Math.abs(diasGuia)} dia(s)`
        : `Vence em ${diasGuia} dia(s)`;

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Início</h1>
        <p className="mt-1 text-sm text-muted-foreground">Visão geral da sua empresa.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardCard
          title="Receita do mês"
          Icon={Wallet}
          value={brl.format(metrics.receitaMes)}
          subtitle={`${metrics.notasMes} nota(s) emitida(s) este mês`}
          tone="success"
        />
        <DashboardCard
          title="Próxima obrigação"
          Icon={CalendarClock}
          value={guia && guia.valor_total != null ? brl.format(guia.valor_total) : 'Nenhuma'}
          subtitle={guiaSubtitle}
          tone={guiaTone}
          action={guia ? { label: 'Pagar', href: '/impostos' } : undefined}
        />
        <DashboardCard
          title="Última nota emitida"
          Icon={FileText}
          value={ultima && ultima.valor_total != null ? brl.format(ultima.valor_total) : 'Nenhuma'}
          subtitle={ultima ? `Em ${fmtData(ultima.data_emissao)}` : 'Você ainda não emitiu notas'}
          action={{ label: 'Emitir nova', href: '/notas_fiscais' }}
        />
        <DashboardCard
          title="Notas no mês"
          Icon={Receipt}
          value={String(metrics.notasMes)}
          subtitle="Notas autorizadas na competência atual"
        />
      </div>

      <div className="mt-6">
        <PendingActionsList actions={pending} />
      </div>
    </main>
  );
}
