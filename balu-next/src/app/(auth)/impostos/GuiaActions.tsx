'use client';
// @custom — PR 3.1 — Ações de uma guia: Marcar paga, Baixar PDF, Copiar linha
// digitável. Client island reusada pelo CompetenciaAtualCard e HistoricoGuias.
import { useState, useTransition } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { marcarGuiaPagaAction } from './actions';
import type { GuiaRow } from './HistoricoGuias';

type Variant = 'primary' | 'inline';

export default function GuiaActions({ guia, variant = 'inline' }: { guia: GuiaRow; variant?: Variant }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const ehPaga = (guia.status ?? '').toLowerCase() === 'paga';

  function handleMarcarPaga() {
    if (pending || ehPaga) return;
    startTransition(async () => {
      const r = await marcarGuiaPagaAction(guia.id);
      if (r.ok) toast('success', 'Guia marcada como paga.');
      else toast('error', r.error);
    });
  }

  async function handleCopiar() {
    if (!guia.linhaDigitavel) {
      toast('warning', 'Esta guia não tem linha digitável.');
      return;
    }
    try {
      await navigator.clipboard.writeText(guia.linhaDigitavel);
      setCopied(true);
      toast('success', 'Linha digitável copiada.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('error', 'Não consegui copiar — tente selecionar manualmente.');
    }
  }

  const baseCls = variant === 'primary'
    ? 'w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition'
    : 'inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium transition';

  return (
    <>
      {!ehPaga && (
        <button
          type="button"
          onClick={handleMarcarPaga}
          disabled={pending}
          className={`${baseCls} ${
            variant === 'primary'
              ? 'bg-primary text-white hover:opacity-90 disabled:opacity-50'
              : 'text-zinc-700 hover:bg-zinc-50 disabled:opacity-50'
          }`}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {pending ? 'Marcando…' : 'Marcar paga'}
        </button>
      )}

      <button
        type="button"
        onClick={handleCopiar}
        disabled={!guia.linhaDigitavel}
        className={`${baseCls} ${
          variant === 'primary'
            ? 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40'
            : 'text-zinc-700 hover:bg-zinc-50 disabled:opacity-40'
        }`}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copiado!' : 'Copiar linha'}
      </button>

      {guia.pdfUrl && (
        <a
          href={guia.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${baseCls} ${
            variant === 'primary'
              ? 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              : 'text-zinc-700 hover:bg-zinc-50'
          }`}
        >
          <Download className="size-4" />
          Baixar PDF
        </a>
      )}
    </>
  );
}
