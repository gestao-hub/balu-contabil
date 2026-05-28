'use client';
// @custom — Botão icone "Atualizar status" pra cada linha pendente da listagem.
// Cada instância tem seu próprio useTransition (loading independente).
// stopPropagation no click pra não disparar o navigate da linha pai.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { atualizarStatusNotaAction } from './actions';

const STATUS_MSG: Record<string, string> = {
  ativa: 'Nota autorizada!',
  cancelada: 'Nota cancelada na SEFAZ.',
  erro: 'A prefeitura rejeitou — abra a nota pra ver o motivo.',
  pendente: 'Ainda processando, tente em alguns segundos.',
};

export default function AtualizarStatusIcon({ notaId }: { notaId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation(); // não navega pra detail
    if (pending) return;
    startTransition(async () => {
      const r = await atualizarStatusNotaAction(notaId);
      if (!r.ok) {
        toast('error', r.error);
        return;
      }
      const msg = STATUS_MSG[r.status] ?? `Status: ${r.status}`;
      const kind = r.status === 'ativa' ? 'success' : r.status === 'erro' ? 'error' : 'info';
      toast(kind, msg);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Atualizar status"
      aria-label="Atualizar status da nota"
      className="inline-flex items-center justify-center rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
    </button>
  );
}
