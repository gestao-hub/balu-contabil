'use client';
// Interruptor "Conta de teste" da lista de usuários (0113).
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { definirContaTesteAction } from './actions';

export default function ContaTesteToggle({ userId, email, inicial }: { userId: string; email: string | null; inicial: boolean }) {
  const toast = useToast();
  const [teste, setTeste] = useState(inicial);
  const [pending, start] = useTransition();

  function alternar() {
    const novo = !teste;
    const alvo = email ?? 'este usuário';
    const pergunta = novo
      ? `Marcar ${alvo} como conta de teste? As empresas e escritórios dele ficam liberados, sem assinatura e sem prazo.`
      : `Desmarcar ${alvo}? A assinatura volta a trial vencendo hoje, e a conta passa a precisar assinar.`;
    if (!window.confirm(pergunta)) return;
    start(async () => {
      const r = await definirContaTesteAction(userId, novo);
      if (!r.ok) { toast('error', r.error); return; }
      setTeste(novo);
      toast('success', novo ? 'Marcada como conta de teste.' : 'Conta de teste desmarcada.');
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={teste}
      aria-label={`Conta de teste: ${email ?? userId}`}
      onClick={alternar}
      disabled={pending}
      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-60 ${
        teste ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-muted-foreground hover:text-foreground'
      }`}
    >
      {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {teste ? 'Teste' : 'Normal'}
    </button>
  );
}
