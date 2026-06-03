'use client';
// @custom — Botão "Consultar na SERPRO" (Simples). Chama consultarDeclaracoesAction e recarrega.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDeclaracoesAction } from './actions';

export default function ConsultarSerproButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await consultarDeclaracoesAction();
      if (r.ok) {
        toast('success', `Listagem atualizada (${r.count} ${r.count === 1 ? 'período' : 'períodos'}).`);
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
      {pending ? 'Consultando…' : 'Consultar na SERPRO'}
    </button>
  );
}
