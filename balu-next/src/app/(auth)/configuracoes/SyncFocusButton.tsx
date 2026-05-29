'use client';
// @custom — Focus 2.1/3: client island do botão "Sincronizar com Focus" no Diagnóstico.
// Adaptativo: a action decide POST (cadastro inicial) ou PUT (atualização)
// baseado em `companies.focus_token`. UI mostra sempre "Sincronizar".
import { useState, useTransition } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { syncFocusEmpresaAction } from './actions';

export default function SyncFocusButton() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  function handleClick() {
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        const r = await syncFocusEmpresaAction();
        if (r.ok) toast('success', 'Empresa sincronizada na Focus.');
        else toast('error', r.error);
      } finally {
        setBusy(false);
      }
    });
  }

  const loading = busy || pending;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50 shrink-0 whitespace-nowrap"
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {loading ? 'Sincronizando…' : 'Sincronizar com Focus'}
    </button>
  );
}
