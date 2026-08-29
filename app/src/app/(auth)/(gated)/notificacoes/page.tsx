// @custom — Bloco 1 (Motor de Obrigações + Notificações), Task 8: página
// /notificacoes. Lista completa das notificações do usuário logado — a RLS
// `notifications_select_own` já restringe a `owner_user_id = auth.uid()`.

import { Bell } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getGateContext } from '@/lib/auth/gate-context';
import { subtituloPorPapel } from '@/lib/notifications/copy-por-papel';
import { marcarTodasLidasAction } from './actions';
import type { Severidade } from '@/lib/notifications/tipos';

type Notificacao = {
  id: string;
  titulo: string;
  corpo: string;
  norma: string | null;
  severidade: Severidade;
  action_href: string | null;
  lida_em: string | null;
  created_at: string;
  company_id: string | null;
};

const SEVERIDADE_DOT: Record<Severidade, string> = {
  info: 'bg-primary',
  warning: 'bg-alert',
  danger: 'bg-destructive',
};

function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Wrapper de retorno void — <form action> exige (formData) => void | Promise<void>,
// e marcarTodasLidasAction devolve Result para uso no sino (client component).
async function marcarTodasWrapper(): Promise<void> {
  'use server';
  await marcarTodasLidasAction();
}

export default async function NotificacoesPage(
  { searchParams }: { searchParams: Promise<{ sel?: string }> },
) {
  const { sel } = await searchParams;
  const supabase = await createServerClient();
  const subtitulo = subtituloPorPapel((await getGateContext())?.normalizedRole ?? null);

  // Notificação aberta pelo sino (?sel=<id>): marca como lida antes de listar.
  // A RLS `notifications_update_own` garante que só a própria linha é afetada.
  if (sel) {
    await supabase.from('notifications').update({ lida_em: new Date().toISOString() }).eq('id', sel).is('lida_em', null);
  }

  // RPC (não `.from('notifications').select()` direto) — mesma razão do sino
  // em SinoNotificacoes.tsx: sem o join com guias_fiscais, uma notificação
  // das_a_vencer/das_vencido de guia já paga continuava listada aqui como
  // pendente. A 0067 estendeu `notificacoes_sino` com `norma` (esta página
  // mostra a norma; o sino não) e com o filtro de `resolvida_em`.
  const { data } = await supabase.rpc('notificacoes_sino', { p_limite: 100 });

  const itens = (data as Notificacao[] | null) ?? [];
  const naoLidas = itens.filter((n) => !n.lida_em).length;

  // De qual empresa é cada aviso. Só vira texto na tela quando o usuário tem mais
  // de uma — com uma só, o nome repetido em toda linha é ruído.
  const { data: empresas } = await supabase
    .from('companies')
    .select('id,razao_social')
    .is('deleted_at', null);
  const nomeEmpresa = new Map((empresas ?? []).map((e) => [e.id as string, e.razao_social as string]));
  const multiEmpresa = nomeEmpresa.size > 1;

  return (
    <main className="p-6 max-w-2xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Notificações</h1>
          </div>
          {/* BUG-007 (auditoria 29/08/2026): o Admin lia "obrigações da sua
              empresa" — e ele não tem empresa. A tela é a mesma para os três
              papéis, então a frase tem de ser do papel, não da Empresa.
              `getGateContext` é memoizado por request (o layout já o chamou),
              então ler o papel aqui não custa ida ao banco. */}
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        {naoLidas > 0 && (
          <form action={marcarTodasWrapper}>
            <button type="submit" className="shrink-0 text-sm font-medium text-primary hover:underline">
              Marcar todas como lidas
            </button>
          </form>
        )}
      </header>

      {itens.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Você está em dia. Nenhuma notificação.
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((n) => {
            const empresa = n.company_id ? nomeEmpresa.get(n.company_id) : undefined;
            const mostrarEmpresa = multiEmpresa && empresa;
            return (
            <li key={n.id} id={`n-${n.id}`} className={`scroll-mt-6 rounded-md border bg-surface p-3 ${sel === n.id ? 'border-primary ring-2 ring-primary/40' : 'border-border'} ${n.lida_em && sel !== n.id ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 gap-2">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERIDADE_DOT[n.severidade]}`} />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{n.titulo}</p>
                    <p className="text-sm text-muted-foreground">{n.corpo}</p>
                    {n.norma && <p className="mt-1 text-xs text-muted-foreground">{n.norma}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mostrarEmpresa && <span className="font-medium text-foreground">{empresa} · </span>}
                      {dataHoraBR(n.created_at)}
                    </p>
                  </div>
                </div>
                {n.action_href && (
                  // Passa por /notificacoes/abrir: a empresa ativa vira a do aviso
                  // antes de chegar na página. Ir direto no action_href abria a
                  // página da empresa errada pra quem tem mais de uma.
                  <a href={`/notificacoes/abrir/${n.id}`} className="shrink-0 text-sm font-medium text-primary hover:underline">
                    {mostrarEmpresa ? `Abrir em ${empresa}` : 'Abrir'}
                  </a>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
