'use client';
// @custom — Botão "Gerar DAS" (Simples). Chama gerarDasSimplesAction e recarrega.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarDasSimplesAction } from './actions';

export default function GerarDasSimplesButton({
  competencia,
  variant = 'inline',
}: {
  competencia: string;
  variant?: 'inline' | 'primary';
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending || !competencia) return;
    startTransition(async () => {
      const r = await gerarDasSimplesAction(competencia);
      if (r.ok && r.semValor) {
        toast('info', 'Sem débito em aberto para esta competência.');
        router.refresh();
      } else if (r.ok) {
        toast('success', 'DAS gerado.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  const cls =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50'
      : 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-2 disabled:opacity-50';

  return (
    <button type="button" onClick={handle} disabled={pending} className={cls}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {pending ? 'Gerando…' : 'Gerar DAS'}
    </button>
  );
}
