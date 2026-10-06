'use client';
// "Pagar" de um honorário do lado da empresa. A action devolve o link da
// fatura do Asaas (a que já existia, ou a emitida agora) e ela abre em outra
// aba, onde o cliente escolhe boleto, Pix ou cartão.
//
// A ABA É ABERTA ANTES DO `await`: navegador bloqueia `window.open` que não
// nasce direto do clique. Abre-se uma aba vazia no clique e ela recebe o
// endereço quando a action responde — ou é fechada, se der erro.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { pagarHonorarioAction } from './pagar-actions';

export default function PagarHonorarioButton({ honorarioId }: { honorarioId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function pagar() {
    setErro(null);
    const aba = window.open('', '_blank');
    start(async () => {
      const r = await pagarHonorarioAction(honorarioId);
      if (!r.ok) {
        aba?.close();
        setErro(r.error);
        toast('error', r.error);
        return;
      }
      if (aba) aba.location.href = r.linkFatura;
      else window.location.href = r.linkFatura; // aba bloqueada: abre aqui mesmo
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button" onClick={pagar} disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
        {pending ? 'Abrindo…' : 'Pagar'}
      </button>
      {erro && <p role="alert" className="max-w-56 text-right text-xs text-destructive">{erro}</p>}
    </div>
  );
}
