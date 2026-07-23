'use client';
// src/app/(auth)/contador/equipe/EquipeClient.tsx
// Convite de membros (convidarMembroAction) + lista de membros com remoção
// (removerMembroAction, guard de último membro no servidor) + convites pendentes.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Copy, Check, Loader2, Mail, Trash2 } from 'lucide-react';
import PopupConfirm from '@/components/PopupConfirm';
import { useToast } from '@/components/Toaster';
import { removerMembroAction } from '../actions';
import { convidarMembroAction } from '../convites-actions';

export type MembroRow = {
  user_id: string;
  email: string | null;
  nome: string | null;
  created_at: string;
};

export type ConviteRow = {
  id: string;
  email: string;
  expira_em: string | null;
};

type Props = {
  membros: MembroRow[];
  convites: ConviteRow[];
  currentUserId: string;
};

export default function EquipeClient({ membros, convites, currentUserId }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [convite, setConvite] = useState<{ url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState<MembroRow | null>(null);
  const [pending, start] = useTransition();
  const [removendo, startRemover] = useTransition();

  function handleConvidar(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast('warning', 'Informe o e-mail do colega.');
      return;
    }
    start(async () => {
      const r = await convidarMembroAction(email.trim());
      if (!r.ok) { toast('error', r.error); return; }
      setConvite(r.data ?? null);
      setEmail('');
      toast('success', 'Convite enviado!');
      router.refresh();
    });
  }

  async function handleCopiar() {
    if (!convite) return;
    try {
      await navigator.clipboard.writeText(convite.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast('error', 'Não foi possível copiar o link.');
    }
  }

  function fecharConfirm() { setConfirmando(null); }

  function confirmarRemocao() {
    if (!confirmando) return;
    startRemover(async () => {
      const res = await removerMembroAction(confirmando.user_id);
      fecharConfirm();
      if (res.ok) {
        toast('success', 'Membro removido do escritório.');
        router.refresh();
      } else {
        toast('error', res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Convidar por e-mail ── */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <UserPlus className="size-4 text-primary" />
          Convidar por e-mail
        </h2>
        <form onSubmit={handleConvidar} className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colega@escritorio.com.br"
            className="flex-1 min-w-[220px] rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Enviar convite
          </button>
        </form>

        {convite && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={convite.url}
                className="flex-1 rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopiar}
                aria-label="Copiar link do convite"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2"
              >
                {copiado ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Link válido por 7 dias.</p>
          </div>
        )}
      </section>

      {/* ── Membros ── */}
      <section className="rounded-xl border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          Membros ({membros.length})
        </h2>
        <ul className="divide-y divide-border">
          {membros.map((m) => {
            const isSelf = m.user_id === currentUserId;
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {m.nome?.trim() || m.email || '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.email && m.nome?.trim() ? `${m.email} · ` : ''}
                    Membro desde {new Date(m.created_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmando(m)}
                  disabled={isSelf}
                  title={isSelf ? 'Peça a outro membro para remover sua conta.' : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <Trash2 className="size-3.5" />
                  Remover
                </button>
              </li>
            );
          })}
        </ul>
        {membros.some((m) => m.user_id === currentUserId) && (
          <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">
            Para sair do escritório, peça a outro membro para remover sua conta.
          </p>
        )}
      </section>

      {/* ── Convites pendentes ── */}
      {convites.length > 0 && (
        <section className="rounded-xl border border-border bg-surface">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
            Convites pendentes
          </h2>
          <ul className="divide-y divide-border">
            {convites.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <Mail className="size-4 shrink-0 text-alert" />
                <div>
                  <div className="text-sm text-foreground">{c.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.expira_em
                      ? `Expira em ${new Date(c.expira_em).toLocaleDateString('pt-BR')} · `
                      : ''}
                    aguardando aceite
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PopupConfirm
        open={confirmando !== null}
        title="Remover membro"
        description="Remover este membro do escritório? Ele perde o acesso aos dados dos clientes."
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        variant="destructive"
        busy={removendo}
        onConfirm={confirmarRemocao}
        onCancel={fecharConfirm}
      />
    </div>
  );
}
