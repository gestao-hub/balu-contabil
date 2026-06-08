'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDeclaracoesAction, marcarSincronizacaoInicialAction } from './actions';

export default function GateInicialSerpro() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await consultarDeclaracoesAction();
      if (!r.ok) {
        toast('error', r.error);
        return;
      }
      const m = await marcarSincronizacaoInicialAction();
      if (!m.ok) {
        // Dados foram salvos; o gate reaparecerá mas o usuário pode tentar de novo.
        toast('warning', 'Histórico importado, mas não foi possível salvar o marco de sincronização.');
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-xl border border-border bg-surface p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
        {pending ? (
          <Loader2 className="size-7 text-primary animate-spin" />
        ) : (
          <Download className="size-7 text-primary" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">
          Traga seu histórico de declarações agora
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Sincronize com a SERPRO para ver suas guias e declarações anteriores.
        </p>
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sincronizando…
          </>
        ) : (
          'Atualizar'
        )}
      </button>
    </div>
  );
}
