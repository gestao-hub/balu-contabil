// @custom — Bloco 1 (Motor de Obrigações + Notificações), Task 8: página
// /notificacoes. Lista completa das notificações do usuário logado — a RLS
// `notifications_select_own` já restringe a `owner_user_id = auth.uid()`.

import { Bell } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
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

export default async function NotificacoesPage() {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('notifications')
    .select('id,titulo,corpo,norma,severidade,action_href,lida_em,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const itens = (data as Notificacao[] | null) ?? [];
  const naoLidas = itens.filter((n) => !n.lida_em).length;

  return (
    <main className="p-6 max-w-2xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Notificações</h1>
          </div>
          <p className="text-sm text-muted-foreground">Avisos e lembretes de obrigações da sua empresa.</p>
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
          {itens.map((n) => (
            <li key={n.id} className={`rounded-md border border-border bg-surface p-3 ${n.lida_em ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 gap-2">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERIDADE_DOT[n.severidade]}`} />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{n.titulo}</p>
                    <p className="text-sm text-muted-foreground">{n.corpo}</p>
                    {n.norma && <p className="mt-1 text-xs text-muted-foreground">{n.norma}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{dataHoraBR(n.created_at)}</p>
                  </div>
                </div>
                {n.action_href && (
                  <a href={n.action_href} className="shrink-0 text-sm font-medium text-primary hover:underline">
                    Abrir
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
