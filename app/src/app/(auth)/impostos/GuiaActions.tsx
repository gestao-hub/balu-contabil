'use client';
// @custom — Ações de uma guia: Copiar linha digitável + Baixar PDF.
// "Marcar paga" removido — o status real de pagamento vem da SERPRO via cron,
// não por marcação manual do usuário. Client island reusada por
// CompetenciaAtualCard e HistoricoGuias.
import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import type { GuiaRow } from './HistoricoGuias';

type Variant = 'primary' | 'inline';

export default function GuiaActions({ guia, variant = 'inline' }: { guia: GuiaRow; variant?: Variant }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

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

  const isPdfDataUri = (guia.pdfUrl ?? '').startsWith('data:application/pdf;base64,');
  const safePdfUrl =
    isPdfDataUri || /^https?:\/\//i.test(guia.pdfUrl ?? '') ? guia.pdfUrl : null;

  const baseCls = variant === 'primary'
    ? 'w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition'
    : 'inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition';

  return (
    <>
      <button
        type="button"
        onClick={handleCopiar}
        disabled={!guia.linhaDigitavel}
        className={`${baseCls} ${
          variant === 'primary'
            ? 'border border-border text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-40'
            : 'text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-40'
        }`}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copiado!' : 'Copiar linha'}
      </button>

      {safePdfUrl && (
        <a
          href={safePdfUrl}
          {...(isPdfDataUri ? { download: 'das.pdf' } : { target: '_blank', rel: 'noopener noreferrer' })}
          className={`${baseCls} ${
            variant === 'primary'
              ? 'border border-border text-muted-foreground-2 hover:bg-surface-2'
              : 'text-muted-foreground-2 hover:bg-surface-2'
          }`}
        >
          <Download className="size-4" />
          Baixar PDF
        </a>
      )}
    </>
  );
}
