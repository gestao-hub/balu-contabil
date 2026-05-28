'use client';
// @custom — Botão "Reenviar e-mail de confirmação" da tela /cadastro/confirme-email.
// Chama resendConfirmacaoAction; mostra toast de sucesso/erro.
import { useState, useTransition } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { resendConfirmacaoAction } from '../actions';

export default function ResendButton({ email }: { email: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [cooldown, setCooldown] = useState(false);

  function handleClick() {
    if (pending || cooldown) return;
    startTransition(async () => {
      const r = await resendConfirmacaoAction(email);
      if (r.ok) {
        toast('success', 'E-mail reenviado. Cheque sua caixa de entrada.');
        // Cooldown 30s pra evitar abuso (Supabase também tem rate limit).
        setCooldown(true);
        setTimeout(() => setCooldown(false), 30_000);
      } else {
        toast('error', r.error);
      }
    });
  }

  const loading = pending || cooldown;
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      {pending ? 'Reenviando…' : cooldown ? 'Aguarde para reenviar…' : 'Reenviar e-mail'}
    </button>
  );
}
