'use client';
// Parcelamentos do Simples/MEI na Receita (0112): os pedidos guardados, o botão
// que consulta de novo e, para cada parcelamento ativo, as parcelas que a
// Receita deixa emitir — com o DAS de cada uma baixado na hora.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, ListChecks, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { dataBrt, dataHoraBrt } from '@/lib/format/data-brt';
import { brl } from '@/lib/fiscal/guia';
import { parcelamentoAtivo, modalidadePorSistema } from '@/lib/fiscal/parcelamento-parse';
import { consultarParcelamentosAction, gerarDasParcelaAction, parcelasDisponiveisAction } from './actions';

export type ParcelamentoVm = {
  id: string;
  modalidade: string;
  numero: string;
  dataPedido: string | null;
  situacao: string | null;
  dataSituacao: string | null;
};

const competencia = (aaaamm: string) => `${aaaamm.slice(4, 6)}/${aaaamm.slice(0, 4)}`;

/** Base64 → arquivo baixado, sem passar por URL de dados na barra de endereço. */
function baixarPdf(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function LinhaParcelamento({ p }: { p: ParcelamentoVm }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [gerando, setGerando] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState<{ parcela: string; valor: number | null }[] | null>(null);
  const ativo = parcelamentoAtivo(p.situacao);

  function verParcelas() {
    start(async () => {
      const r = await parcelasDisponiveisAction(p.id);
      if (!r.ok) { toast('error', r.error); return; }
      setParcelas(r.data?.parcelas ?? []);
    });
  }

  function gerar(parcela: string) {
    setGerando(parcela);
    start(async () => {
      const r = await gerarDasParcelaAction(p.id, parcela);
      setGerando(null);
      if (!r.ok || !r.data) { toast('error', r.ok ? 'Falha ao gerar.' : r.error); return; }
      baixarPdf(r.data.pdfBase64, `das-parcela-${p.numero}-${parcela}.pdf`);
    });
  }

  return (
    <li className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {modalidadePorSistema(p.modalidade)?.nome ?? p.modalidade} · nº {p.numero}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.situacao ?? 'Situação não informada'}
            {p.dataSituacao ? ` desde ${dataBrt(p.dataSituacao)}` : ''}
            {p.dataPedido ? ` · pedido em ${dataBrt(p.dataPedido)}` : ''}
          </p>
        </div>
        {ativo && parcelas === null && (
          <button
            type="button" onClick={verParcelas} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />} Ver parcelas
          </button>
        )}
      </div>
      {parcelas !== null && (
        parcelas.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nenhuma parcela disponível para emitir agora.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {parcelas.map((x) => (
              <li key={x.parcela} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">Parcela {competencia(x.parcela)} · <span className="tabular-nums">{brl(x.valor)}</span></span>
                <button
                  type="button" onClick={() => gerar(x.parcela)} disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {gerando === x.parcela ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} DAS
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  );
}

export default function ParcelamentosCard({
  parcelamentos, consultadoEm, companyId = null, temCertificado,
}: { parcelamentos: ParcelamentoVm[]; consultadoEm: string | null; companyId?: string | null; temCertificado: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function consultar() {
    start(async () => {
      const r = await consultarParcelamentosAction(companyId);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', r.data?.encontrados ? `${r.data.encontrados} parcelamento(s) encontrado(s).` : 'Nenhum parcelamento na Receita.');
      if (r.data?.falhas.length) toast('warning', `Não consegui consultar: ${r.data.falhas.join(', ')}.`);
      router.refresh();
    });
  }

  return (
    <section className="mb-8 space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Parcelamentos na Receita</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {consultadoEm ? `Consultado em ${dataHoraBrt(consultadoEm)}.` : 'Ainda não consultado.'} Simples e MEI.
          </p>
        </div>
        <button
          type="button" onClick={consultar} disabled={pending || !temCertificado}
          title={temCertificado ? 'Consultar os parcelamentos na Receita' : 'É preciso o certificado digital A1 da empresa'}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {pending ? 'Consultando…' : 'Consultar parcelamentos'}
        </button>
      </div>
      {parcelamentos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum parcelamento registrado.</p>
      ) : (
        <ul className="space-y-2">{parcelamentos.map((p) => <LinhaParcelamento key={p.id} p={p} />)}</ul>
      )}
    </section>
  );
}
