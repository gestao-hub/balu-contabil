// src/app/(auth)/conta/PerfilForm.tsx
'use client';
import { useState, useTransition } from 'react';
import { Pencil, Save, X, Mail } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { updateNomeAction, updateEmailAction } from './actions';

type Props = {
  initialNome: string;
  email: string;
  role: string;
};

export default function PerfilForm({ initialNome, email, role }: Props) {
  const toast = useToast();
  const [isPendingNome, startNome] = useTransition();
  const [isPendingEmail, startEmail] = useTransition();

  // — Nome
  const [editingNome, setEditingNome] = useState(false);
  const [nome, setNome] = useState(initialNome);
  const [nomeTemp, setNomeTemp] = useState(initialNome);

  // — Email inline form
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  function handleNomeSave() {
    startNome(async () => {
      const r = await updateNomeAction(nomeTemp);
      if (!r.ok) { toast('error', r.error); return; }
      setNome(nomeTemp);
      setEditingNome(false);
      toast('success', 'Nome atualizado.');
    });
  }

  function handleNomeCancel() {
    setNomeTemp(nome);
    setEditingNome(false);
  }

  function handleEmailSend() {
    startEmail(async () => {
      const r = await updateEmailAction(newEmail);
      if (!r.ok) { toast('error', r.error); return; }
      toast('info', r.message ?? 'Link enviado.');
      setShowEmailForm(false);
      setNewEmail('');
    });
  }

  return (
    <div className="max-w-lg space-y-6">

      {/* Nome */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Nome de exibição</p>
        {editingNome ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nomeTemp}
              onChange={(e) => setNomeTemp(e.target.value)}
              autoFocus
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={handleNomeSave}
              disabled={isPendingNome}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              Salvar
            </button>
            <button
              type="button"
              onClick={handleNomeCancel}
              disabled={isPendingNome}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground">{nome || <span className="text-muted-foreground italic">Não definido</span>}</p>
            <button
              type="button"
              onClick={() => { setNomeTemp(nome); setEditingNome(true); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground-2 hover:bg-surface-2"
            >
              <Pencil className="size-3" />
              Editar
            </button>
          </div>
        )}
      </div>

      {/* Email */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Email</p>
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">{email}</p>
          {!showEmailForm && (
            <button
              type="button"
              onClick={() => setShowEmailForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground-2 hover:bg-surface-2"
            >
              <Mail className="size-3" />
              Alterar email
            </button>
          )}
        </div>
        {showEmailForm && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="email"
              placeholder="Novo email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoFocus
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={handleEmailSend}
              disabled={isPendingEmail || !newEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Enviar confirmação
            </button>
            <button
              type="button"
              onClick={() => { setShowEmailForm(false); setNewEmail(''); }}
              disabled={isPendingEmail}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Tipo de conta — read-only */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Tipo de conta</p>
        <p className="text-sm text-foreground capitalize">{role}</p>
      </div>

    </div>
  );
}
