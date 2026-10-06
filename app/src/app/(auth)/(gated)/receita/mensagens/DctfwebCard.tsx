'use client';
// DCTFWeb do mês (folha, INSS e retenções): recibo de entrega e DARF.
// Só leitura e guia — a transmissão não é feita pela Balu (ver lib/fiscal/dctfweb.ts).
import { useState, useTransition } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { documentoDctfwebAction } from './actions';

function baixarPdf(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Mês anterior ao de hoje, em YYYY-MM (valor de <input type="month">). */
function mesAnterior(hoje: string): string {
  const [a, m] = hoje.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

export default function DctfwebCard({ companyId = null, hojeYmd, temCertificado }: {
  companyId?: string | null;
  /** YYYY-MM-DD em BRT, vindo do servidor (o relógio do navegador não manda). */
  hojeYmd: string;
  temCertificado: boolean;
}) {
  const toast = useToast();
  const [mes, setMes] = useState(mesAnterior(hojeYmd));
  const [pending, start] = useTransition();
  const [qual, setQual] = useState<'recibo' | 'darf' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function pedir(tipo: 'recibo' | 'darf') {
    setErro(null);
    setQual(tipo);
    const competencia = mes.replace('-', '');
    start(async () => {
      const r = await documentoDctfwebAction(companyId, competencia, tipo);
      setQual(null);
      if (!r.ok || !r.data) { const m = r.ok ? 'Falha ao obter o documento.' : r.error; setErro(m); toast('error', m); return; }
      baixarPdf(r.data.pdfBase64, `dctfweb-${tipo}-${competencia}.pdf`);
    });
  }

  return (
    <section className="mb-8 space-y-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="size-4 text-primary" /> DCTFWeb (folha, INSS e retenções)
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Para empresas com funcionário ou pró-labore. Baixe o recibo de entrega ou o DARF da
          declaração do mês. A transmissão continua sendo feita pelo contador.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground-2">Competência</span>
          <input
            type="month" value={mes} max={hojeYmd.slice(0, 7)} onChange={(e) => setMes(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground"
          />
        </label>
        {(['recibo', 'darf'] as const).map((t) => (
          <button
            key={t} type="button" onClick={() => pedir(t)} disabled={pending || !temCertificado || !mes}
            title={temCertificado ? undefined : 'É preciso o certificado digital A1 da empresa'}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-2 disabled:opacity-50"
          >
            {qual === t ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t === 'recibo' ? 'Recibo de entrega' : 'DARF da DCTFWeb'}
          </button>
        ))}
      </div>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </section>
  );
}
