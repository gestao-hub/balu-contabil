'use client';
// @custom — Botão "Gerar DAS" (MEI). Chama gerarDasMeiAction e atualiza a página.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarDasMeiAction } from './actions';

export default function GerarDasButton({ competencia }: { competencia: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await gerarDasMeiAction(competencia);
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

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {pending ? 'Gerando…' : 'Gerar DAS'}
    </button>
  );
}
