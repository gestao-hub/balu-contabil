'use client';
import { useState, useEffect, useTransition } from 'react';
import { useToast } from '@/components/Toaster';
import { Plus, CheckCircle, Pencil, Trash2, Clock, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { marcarPagoAction, deleteHonorarioAction } from './actions';
import HonorarioFormDialog, { type ClienteOption, type HonorarioRow } from './HonorarioFormDialog';
import PopupConfirm from '@/components/PopupConfirm';
import FilterPeriodo, { type PeriodoRange } from '@/components/FilterPeriodo';

export type { HonorarioRow };

const POR_PAGINA = 100;

const STATUS_BADGE: Record<string, string> = {
  pago:     'bg-success/10 text-success border-success/30',
  atrasado: 'bg-destructive/10 text-destructive border-destructive/30',
  pendente: 'bg-alert/10 text-alert border-alert/30',
};

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function mesLabel(d: string) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function dataBR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function primeiroDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-01`;
}

function ultimoDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const last = new Date(brt.getFullYear(), brt.getMonth() + 1, 0).getDate();
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: HonorarioRow[]) {
  const header = ['Cliente', 'Competência', 'Valor (R$)', 'Vencimento', 'Pagamento', 'Status', 'Observação'];
  const lines = [
    '﻿' + header.map(esc).join(';'),
    ...rows.map(r => [
      r.clientes?.razao_social ?? '',
      mesLabel(r.mes_referencia),
      String(r.valor).replace('.', ','),
      dataBR(r.data_vencimento),
      dataBR(r.data_pagamento),
      r.status ?? 'pendente',
      r.observacao ?? '',
    ].map(esc).join(';')),
  ];
  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `honorarios_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Props = {
  initial: HonorarioRow[];
  companyId: string;
  clientes: ClienteOption[];
};

export default function HonorarioList({ initial, companyId, clientes }: Props) {
  const toast = useToast();
  const [rows, setRows]                         = useState(initial);
  const [filtroCliente, setFiltroCliente]       = useState('');
  const [statusChecked, setStatusChecked]       = useState<string[]>([]);
  const [filtroStatuses, setFiltroStatuses]     = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<PeriodoRange>({
    start: primeiroDiaMesISO(),
    end:   ultimoDiaMesISO(),
  });
  const [pagina, setPagina]                     = useState(1);
  const [showForm, setShowForm]                 = useState(false);
  const [editing, setEditing]                   = useState<HonorarioRow | undefined>();
  const [confirmRow, setConfirmRow]             = useState<HonorarioRow | null>(null);
  const [confirmAcao, setConfirmAcao]           = useState<'pagar' | 'excluir' | null>(null);
  const [pending, start]                        = useTransition();

  useEffect(() => { setRows(initial); }, [initial]);

  // Filtragem por data_vencimento (precisão de dia)
  const filtrados = rows.filter(r => {
    if (filtroCliente && r.cliente_id !== filtroCliente) return false;
    if (filtroStatuses.length > 0 && !filtroStatuses.includes(r.status ?? 'pendente')) return false;
    if (periodo.start && r.data_vencimento < periodo.start) return false;
    if (periodo.end   && r.data_vencimento > periodo.end)   return false;
    return true;
  });

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual  = Math.min(pagina, totalPaginas);
  const paginados    = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  // Métricas dos cards (respondem ao filtro aplicado)
  const totalPendente = filtrados.filter(r => r.status === 'pendente' || r.status === null).reduce((s, r) => s + r.valor, 0);
  const totalPago     = filtrados.filter(r => r.status === 'pago').reduce((s, r) => s + r.valor, 0);
  const totalAtrasado = filtrados.filter(r => r.status === 'atrasado').reduce((s, r) => s + r.valor, 0);
  const qtdPendente   = filtrados.filter(r => r.status === 'pendente' || r.status === null).length;
  const qtdPago       = filtrados.filter(r => r.status === 'pago').length;
  const qtdAtrasado   = filtrados.filter(r => r.status === 'atrasado').length;

  function toggleStatus(s: string) { setStatusChecked(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]); }
  function aplicarStatus() { setFiltroStatuses(statusChecked); setPagina(1); }
  function fecharConfirm() { setConfirmRow(null); setConfirmAcao(null); }

  function confirmarAcao() {
    if (!confirmRow || !confirmAcao) return;
    if (confirmAcao === 'pagar') {
      start(async () => {
        const res = await marcarPagoAction(confirmRow.id);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Honorário marcado como pago.');
          setRows(rs => rs.map(r => r.id === confirmRow.id
            ? { ...r, status: 'pago', data_pagamento: new Date().toISOString().slice(0, 10) }
            : r));
        } else { toast('error', res.error); }
      });
    } else {
      start(async () => {
        const res = await deleteHonorarioAction(confirmRow.id);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Honorário excluído.');
          setRows(rs => rs.filter(r => r.id !== confirmRow.id));
        } else { toast('error', res.error); }
      });
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Barra de ações ── */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => downloadCSV(filtrados)}
          disabled={filtrados.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-40"
        >
          <Download className="size-4" />
          Exportar CSV
        </button>
        <button
          onClick={() => { setEditing(undefined); setShowForm(true); }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" />
          Novo honorário
        </button>
      </div>

      {/* ── Cards de resumo ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Pendente</span>
            <span className="grid size-9 place-items-center rounded-lg text-alert bg-alert/10">
              <Clock className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{brl(totalPendente)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{qtdPendente} {qtdPendente === 1 ? 'honorário' : 'honorários'}</p>
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Pago</span>
            <span className="grid size-9 place-items-center rounded-lg text-success bg-success/10">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{brl(totalPago)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{qtdPago} {qtdPago === 1 ? 'honorário' : 'honorários'}</p>
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Atrasado</span>
            <span className="grid size-9 place-items-center rounded-lg text-destructive bg-destructive/10">
              <AlertTriangle className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{brl(totalAtrasado)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{qtdAtrasado} {qtdAtrasado === 1 ? 'honorário' : 'honorários'}</p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Cliente */}
        <select
          value={filtroCliente}
          onChange={e => { setFiltroCliente(e.target.value); setPagina(1); }}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        {/* Status — checkboxes */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
          {(['pendente', 'pago', 'atrasado'] as const).map(s => (
            <label key={s} className="flex items-center gap-1.5 cursor-pointer text-foreground capitalize">
              <input
                type="checkbox"
                checked={statusChecked.includes(s)}
                onChange={() => toggleStatus(s)}
                className="accent-primary"
              />
              {s}
            </label>
          ))}
          <button type="button" onClick={aplicarStatus}
            className="ml-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-white hover:opacity-90">
            Filtrar
          </button>
          {filtroStatuses.length > 0 && (
            <button type="button" onClick={() => { setStatusChecked([]); setFiltroStatuses([]); setPagina(1); }}
              className="text-xs text-muted-foreground hover:text-foreground">
              ✕
            </button>
          )}
        </div>

        {/* Período */}
        <FilterPeriodo
          initial={periodo}
          onChange={p => { setPeriodo(p); setPagina(1); }}
        />
      </div>

      {/* ── Tabela ── */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum honorário encontrado.
        </div>
      ) : (
        <>
          {/* Paginação no topo */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtrados.length)} de {filtrados.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
                <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Competência</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-left">Vencimento</th>
                  <th className="px-4 py-3 text-left">Pagamento</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginados.map(r => (
                  <tr key={r.id} className="bg-surface hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{r.clientes?.razao_social || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{mesLabel(r.mes_referencia)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{brl(r.valor)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_vencimento)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_pagamento)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status ?? 'pendente'] ?? ''}`}>
                        {r.status ?? 'pendente'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {r.status !== 'pago' && (
                          <button onClick={() => { setConfirmRow(r); setConfirmAcao('pagar'); }} disabled={pending}
                            title="Marcar como pago" className="text-success hover:opacity-70 disabled:opacity-40">
                            <CheckCircle className="size-4" />
                          </button>
                        )}
                        {r.status !== 'pago' && (
                          <button onClick={() => { setEditing(r); setShowForm(true); }}
                            title="Editar" className="text-muted-foreground hover:text-foreground">
                            <Pencil className="size-4" />
                          </button>
                        )}
                        <button onClick={() => { setConfirmRow(r); setConfirmAcao('excluir'); }} disabled={pending}
                          title="Excluir" className="text-destructive hover:opacity-70 disabled:opacity-40">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Paginação ── */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtrados.length)} de {filtrados.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
                <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <HonorarioFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(undefined); }}
        companyId={companyId}
        clientes={clientes}
        editing={editing}
      />

      <PopupConfirm
        open={confirmAcao === 'pagar'}
        title="Confirmar pagamento"
        description={`Marcar honorário de ${confirmRow ? brl(confirmRow.valor) : ''} como pago?`}
        confirmLabel="Marcar como pago"
        cancelLabel="Cancelar"
        variant="primary"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      />

      <PopupConfirm
        open={confirmAcao === 'excluir'}
        title="Excluir honorário"
        description={`Tem certeza que deseja excluir o honorário de ${confirmRow ? brl(confirmRow.valor) : ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      />
    </div>
  );
}
