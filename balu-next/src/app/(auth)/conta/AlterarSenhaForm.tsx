// src/app/(auth)/conta/AlterarSenhaForm.tsx
'use client';
import { useState, useTransition } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { updateSenhaAction } from './actions';

export default function AlterarSenhaForm() {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateSenhaAction(senha, confirmar);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Senha atualizada com sucesso.');
      setSenha('');
      setConfirmar('');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alterar senha</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Nova senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={6}
            required
            autoComplete="new-password"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Confirmar senha</span>
          <input
            type="password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            minLength={6}
            required
            autoComplete="new-password"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar senha
        </button>
      </div>
    </form>
  );
}
