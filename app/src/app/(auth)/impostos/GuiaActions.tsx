'use client';
// @custom — Ação de uma guia: Baixar PDF.
// "Copiar linha" e "Marcar paga" removidos — a SERPRO (GERARDAS12) não devolve linha
// digitável (só o PDF) e o status real de pagamento vem da SERPRO via sync/cron.
// Client island reusada por CompetenciaAtualCard e HistoricoGuias.
import { Download } from 'lucide-react';
import type { GuiaRow } from './HistoricoGuias';

type Variant = 'primary' | 'inline';

export default function GuiaActions({ guia, variant = 'inline' }: { guia: GuiaRow; variant?: Variant }) {
  const isPdfDataUri = (guia.pdfUrl ?? '').startsWith('data:application/pdf;base64,');
  const safePdfUrl =
    isPdfDataUri || /^https?:\/\//i.test(guia.pdfUrl ?? '') ? guia.pdfUrl : null;

  if (!safePdfUrl) return null;

  const baseCls = variant === 'primary'
    ? 'w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 transition hover:bg-surface-2'
    : 'inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground-2 transition hover:bg-surface-2';

  return (
    <a
      href={safePdfUrl}
      {...(isPdfDataUri ? { download: 'das.pdf' } : { target: '_blank', rel: 'noopener noreferrer' })}
      className={baseCls}
    >
      <Download className="size-4" />
      Baixar PDF
    </a>
  );
}
