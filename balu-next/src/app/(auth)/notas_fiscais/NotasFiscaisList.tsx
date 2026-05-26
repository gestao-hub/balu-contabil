'use client';

// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
// Listagem de notas: 4 filtros combináveis (período, tipo, status, texto),
// badges, linha clicável → detalhe, export CSV. Padrão de ClientesListClient.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Download } from 'lucide-react';
import FilterPeriodo, { type PeriodoRange } from '@/components/FilterPeriodo';
import { useToast } from '@/components/Toaster';
import { exportNotasCsvAction } from './actions';

// Tabela real `notas_fiscais` é minimalista: o nome do cliente é derivado de
// payload_focusnfe.destinatario (não há FK cliente_id). `referencia` é o identificador.
export type NotaListRow = {
  id: string;
  tipo_documento: string;
  referencia: string;
  data_emissao: string;
  valor_total: number;
  status: string;
  cliente_nome: string | null;
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const TIPO_LABEL: Record<string, string> = { NFe: 'NF-e', NFCe: 'NFC-e', NFSe: 'NFS-e' };
const STATUS_META: Record<string, { label: string; cls: string }> = {
  autorizada: { label: 'Autorizada', cls: 'bg-success/10 text-success' },
  processando: { label: 'Processando', cls: 'bg-alert/10 text-alert' },
  rejeitada: { label: 'Rejeitada', cls: 'bg-destructive/10 text-destructive' },
  cancelada: { label: 'Cancelada', cls: 'bg-zinc-100 text-zinc-600' },
};

function fmtData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

export default function NotasFiscaisList({ initial }: { initial: NotaListRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoRange>({ start: null, end: null });
  const [tipo, setTipo] = useState<string>('todos');
  const [status, setStatus] = useState<string>('todos');
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initial.filter((n) => {
      if (tipo !== 'todos' && n.tipo_documento !== tipo) return false;
      if (status !== 'todos' && n.status !== status) return false;
      if (periodo.start || periodo.end) {
        const d = n.data_emissao?.slice(0, 10) ?? null;
        if (!d) return false;
        if (periodo.start && d < periodo.start) return false;
        if (periodo.end && d > periodo.end) return false;
      }
      if (q) {
        const hay = `${n.referencia ?? ''} ${n.cliente_nome ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [initial, query, tipo, status, periodo]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await exportNotasCsvAction({
        start: periodo.start,
        end: periodo.end,
        tipo: tipo === 'todos' ? null : tipo,
        status: status === 'todos' ? null : status,
        text: query.trim() || null,
      });
      if (!res.ok) {
        toast('error', res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('success', 'CSV exportado.');
    } catch {
      toast('error', 'Falha ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por referência ou cliente"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Filtrar por tipo"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="todos">Todos os tipos</option>
            <option value="NFe">NF-e</option>
            <option value="NFCe">NFC-e</option>
            <option value="NFSe">NFS-e</option>
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filtrar por status"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="todos">Todos os status</option>
            <option value="autorizada">Autorizada</option>
            <option value="processando">Processando</option>
            <option value="rejeitada">Rejeitada</option>
            <option value="cancelada">Cancelada</option>
          </select>

          <FilterPeriodo onChange={setPeriodo} />

          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Download className="size-4" />
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Referência</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium text-right">Valor</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                  {initial.length === 0
                    ? 'Nenhuma nota emitida ainda.'
                    : 'Nenhuma nota encontrada para os filtros.'}
                </td>
              </tr>
            ) : (
              filtered.map((n) => {
                const st = n.status ? STATUS_META[n.status] : undefined;
                return (
                  <tr
                    key={n.id}
                    onClick={() => router.push(`/notas_fiscais/${n.id}`)}
                    className="cursor-pointer hover:bg-zinc-50/60"
                  >
                    <td className="px-4 py-3 text-zinc-700">{fmtData(n.data_emissao)}</td>
                    <td className="px-4 py-3 text-zinc-700">{TIPO_LABEL[n.tipo_documento] ?? n.tipo_documento}</td>
                    <td className="px-4 py-3 text-zinc-700">{n.referencia ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-brand-navy">
                      {n.cliente_nome ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700">
                      {n.valor_total != null ? brl.format(n.valor_total) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          st?.cls ?? 'bg-zinc-100 text-zinc-600'
                        }`}
                      >
                        {st?.label ?? n.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
