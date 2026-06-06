'use client';
// @custom — Botão "Consultar declarações (SERPRO)" para MEI. Chama consultarDasnSimeiAction e recarrega.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDasnSimeiAction } from './actions';

export default function ConsultarDasnSimeiButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await consultarDasnSimeiAction();
      if (r.ok) {
        toast('success', `Declarações atualizadas (${r.count} ${r.count === 1 ? 'declaração' : 'declarações'}).`);
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {pending ? 'Consultando…' : 'Consultar declarações (SERPRO)'}
    </button>
  );
}
