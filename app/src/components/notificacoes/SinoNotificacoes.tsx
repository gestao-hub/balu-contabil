'use client';

// @custom — Bloco 1 (Motor de Obrigações + Notificações), Task 7: sino de
// notificações na sidebar. Busca as últimas notificações do usuário logado
// (RLS já restringe a `owner_user_id = auth.uid()`) e assina Realtime pra
// atualizar o contador/lista sem precisar recarregar a página.

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { marcarTodasLidasAction } from '@/app/(auth)/(gated)/notificacoes/actions';
import type { Severidade } from '@/lib/notifications/tipos';

type Notificacao = {
  id: string;
  titulo: string;
  corpo: string;
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

export function SinoNotificacoes({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Notificacao[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  async function carregar() {
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from('notifications')
      .select('id,titulo,corpo,severidade,action_href,lida_em,created_at')
      .order('created_at', { ascending: false })
      .limit(15);
    setItens((data as Notificacao[] | null) ?? []);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: qualquer INSERT/UPDATE em notifications (já filtrado por RLS)
  // recarrega a lista pra manter o contador em dia sem polling.
  useEffect(() => {
    const supabase = createBrowserClient();
    const canal = supabase
      .channel('sino-notificacoes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => carregar())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fecha o dropdown ao clicar fora — mesmo padrão do seletor de empresa.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const naoLidas = itens.filter((i) => !i.lida_em).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notificações"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground"
      >
        <span className="relative shrink-0">
          <Bell className="size-4" />
          {naoLidas > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-white">
              {naoLidas > 9 ? '9+' : naoLidas}
            </span>
          )}
        </span>
        {!collapsed && <span className="truncate">Notificações</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-80 overflow-auto rounded-md border border-border bg-surface-2 shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">Notificações</span>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await marcarTodasLidasAction();
                  carregar();
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          {itens.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nada por aqui.</p>
          ) : (
            <ul className="divide-y divide-border">
              {itens.map((n) => (
                <li key={n.id}>
                  <a
                    href={n.action_href ?? '/notificacoes'}
                    className={`flex gap-2 px-3 py-2 hover:bg-surface-3 ${n.lida_em ? 'opacity-60' : ''}`}
                  >
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERIDADE_DOT[n.severidade]}`} />
                    <span className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{n.titulo}</p>
                      <p className="truncate text-xs text-muted-foreground">{n.corpo}</p>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <a
            href="/notificacoes"
            className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-primary hover:underline"
          >
            Ver todas
          </a>
        </div>
      )}
    </div>
  );
}
