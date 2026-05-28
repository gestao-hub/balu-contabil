'use client';
// @custom — Focus 3: client island do botão "Cadastrar/Tentar novamente" na Focus.
import { useState, useTransition } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { retryFocusEmpresaAction } from './actions';

export default function RetryFocusButton() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  function handleClick() {
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        const r = await retryFocusEmpresaAction();
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
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 shrink-0 whitespace-nowrap"
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {loading ? 'Sincronizando…' : 'Cadastrar na Focus agora'}
    </button>
  );
}
