// src/app/(auth)/conta/DangerZone.tsx
'use client';
import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { deleteAccountAction } from './actions';

type Props = { email: string };

export default function DangerZone({ email }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [isPending, startTransition] = useTransition();

  const confirmed = typed.trim().toLowerCase() === email.toLowerCase();

  function handleConfirm() {
    if (!confirmed) return;
    startTransition(async () => {
      const r = await deleteAccountAction();
      // Se chegou aqui sem redirect, é erro
      if (!r.ok) {
        toast('error', r.error);
        setOpen(false);
        setTyped('');
      }
    });
  }

  function handleCancel() {
    setOpen(false);
    setTyped('');
  }

  return (
    <>
      <div className="max-w-lg rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-semibold text-destructive mb-1">Zona de risco</p>
        <p className="text-xs text-muted-foreground-2 mb-4">
          Excluir conta é irreversível. Empresas, notas fiscais, clientes e todos os dados
          vinculados serão permanentemente excluídos.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Trash2 className="size-4" />
          Excluir minha conta
        </button>
      </div>

      <PopupConfirm
        open={open}
        variant="destructive"
        title="Excluir conta permanentemente"
        description="Esta ação não pode ser desfeita. Digite seu email para confirmar."
        confirmLabel="Excluir conta"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        busy={isPending}
      >
        <input
          type="email"
          placeholder={email}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
        />
        {typed && !confirmed && (
          <p className="mt-1 text-xs text-destructive">Email incorreto.</p>
        )}
      </PopupConfirm>
    </>
  );
}
