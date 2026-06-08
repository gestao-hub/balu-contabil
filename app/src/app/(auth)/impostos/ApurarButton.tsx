'use client';
// @custom — Botão "Apurar": recalcula a apuração local da competência (cálculo interno, das notas)
// e salva. Idempotente — pode rodar quantas vezes quiser, não chama SERPRO. Usado na seção
// Apuração do detalhe, para meses ainda não transmitidos.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { iniciarApuracaoAction } from './actions';

export default function ApurarButton({ competencia, recalcular = false }: { competencia: string; recalcular?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await iniciarApuracaoAction(competencia, 'commit');
      if (r.ok) {
        toast('success', 'Apuração calculada.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  const label = recalcular ? 'Recalcular apuração' : 'Apurar';
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
      {pending ? 'Apurando…' : label}
    </button>
  );
}
