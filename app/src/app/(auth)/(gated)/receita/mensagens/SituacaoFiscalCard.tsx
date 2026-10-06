'use client';
// Situação fiscal na Receita/PGFN (SITFIS, 0111): último relatório, o indício
// de pendência lido dele, "Baixar" e "Emitir agora".
//
// O resultado é INDÍCIO (texto lido do PDF oficial): 'indeterminado' aparece
// como tal, sem selo verde nem vermelho — o PDF é que vale.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, FileSearch, HelpCircle, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { dataHoraBrt } from '@/lib/format/data-brt';
import { baixarRelatorioSitfisAction, emitirSituacaoFiscalAction } from './actions';

export type RelatorioSitfisVm = {
  id: string;
  emitidoEm: string;
  resultado: 'sem_pendencias' | 'com_pendencias' | 'indeterminado';
};

const SELO = {
  sem_pendencias: { Icon: CheckCircle2, texto: 'Sem pendências apontadas', cor: 'text-success bg-success/10 border-success/30' },
  com_pendencias: { Icon: AlertTriangle, texto: 'Há pendências — veja o relatório', cor: 'text-destructive bg-destructive/10 border-destructive/30' },
  indeterminado: { Icon: HelpCircle, texto: 'Resultado não identificado — confira o PDF', cor: 'text-muted-foreground-2 bg-surface-2 border-border' },
} as const;

export default function SituacaoFiscalCard({
  ultimo, companyId = null, temCertificado,
}: { ultimo: RelatorioSitfisVm | null; companyId?: string | null; temCertificado: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [baixando, startBaixar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function emitir() {
    setErro(null);
    start(async () => {
      const r = await emitirSituacaoFiscalAction(companyId);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', 'Relatório de situação fiscal emitido.');
      router.refresh();
    });
  }

  function baixar() {
    if (!ultimo) return;
    startBaixar(async () => {
      const r = await baixarRelatorioSitfisAction(ultimo.id);
      if (!r.ok || !r.data) { toast('error', r.ok ? 'Falha ao baixar.' : r.error); return; }
      window.location.href = r.data.url;
    });
  }

  const selo = ultimo ? SELO[ultimo.resultado] : null;

  return (
    <section className="mb-8 space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileSearch className="size-4 text-primary" /> Situação fiscal (Receita e PGFN)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            O relatório oficial de pendências — débitos e declarações em falta que impedem a certidão
            negativa. A Balu emite um por semana.
          </p>
        </div>
        <button
          type="button" onClick={emitir} disabled={pending || !temCertificado}
          title={temCertificado ? 'Emitir o relatório agora' : 'É preciso o certificado digital A1 da empresa'}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {pending ? 'Emitindo… (até 30s)' : 'Emitir agora'}
        </button>
      </div>

      {ultimo && selo ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium ${selo.cor}`}>
            <selo.Icon className="size-4" /> {selo.texto}
          </span>
          <span className="text-xs text-muted-foreground">
            Emitido em {dataHoraBrt(ultimo.emitidoEm)}
          </span>
          <button
            type="button" onClick={baixar} disabled={baixando}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Baixar relatório (PDF)
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum relatório emitido ainda.</p>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    </section>
  );
}
