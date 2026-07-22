'use client';
import { useState, useEffect, useTransition } from 'react';
import { useToast } from '@/components/Toaster';
import { Plus, CheckCircle, XCircle, Pencil, Trash2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { marcarPagoV2Action, desmarcarPagoV2Action, deleteHonorarioV2Action } from './actions';
import HonorarioV2FormDialog, { type ClienteOption, type HonorarioV2Row } from './HonorarioV2FormDialog';
import PopupConfirm from '@/components/PopupConfirm';
import { statusHonorario, type StatusHonorario } from '@/lib/fiscal/status-honorario';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';

export type { HonorarioV2Row };

const POR_PAGINA = 100;

const STATUS_BADGE: Record<StatusHonorario, string> = {
  pago:     'bg-success/10 text-success border-success/30',
  atrasado: 'bg-destructive/10 text-destructive border-destructive/30',
  aberto:   'bg-alert/10 text-alert border-alert/30',
};
const STATUS_LABEL: Record<StatusHonorario, string> = { pago: 'Pago', atrasado: 'Atrasado', aberto: 'Aberto' };

const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'outro', label: 'Outro' },
] as const;

function mesLabel(d: string) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** YYYY-MM-DD → YYYY-MM (comparação com o filtro de competência) */
function mesCurto(d: string): string {
  return d ? d.slice(0, 7) : '';
}

function dataBR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${(day ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`;
}

/** Escapa campo CSV: envolve em aspas se contém `"`, `;`, `,`, quebra de linha. */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v).replace(/[\r\n]+/g, ' ');
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: HonorarioV2Row[]) {
  const header = ['Cliente', 'Competência', 'Valor (R$)', 'Vencimento', 'Pagamento', 'Status', 'Recorrente', 'Observação'];
  const lines = [
    '﻿' + header.map(esc).join(';'),
    ...rows.map(r => [
      r.companies?.nome ?? '',
      mesLabel(r.mes_referencia),
      // Valor com vírgula decimal, sempre entre aspas — evita shift de coluna no Excel.
      `"${Number(r.valor).toFixed(2).replace('.', ',')}"`,
      dataBR(r.data_vencimento),
      dataBR(r.data_pagamento),
      STATUS_LABEL[statusHonorario(r)],
      r.recorrente ? `Sim (dia ${r.recorrencia_dia})` : 'Não',
      r.observacao ?? '',
    ].map((v, i) => i === 2 ? v : esc(v)).join(';')),
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
  initial: HonorarioV2Row[];
  clientes: ClienteOption[];
};

export default function HonorariosV2List({ initial, clientes }: Props) {
  const toast = useToast();
  const [rows, setRows]                     = useState(initial);
  const [filtroStatus, setFiltroStatus]     = useState<'' | StatusHonorario>('');
  const [filtroCompetencia, setFiltroCompetencia] = useState('');
  const [pagina, setPagina]                 = useState(1);
  const [showForm, setShowForm]             = useState(false);
  const [editing, setEditing]               = useState<HonorarioV2Row | undefined>();
  const [confirmRow, setConfirmRow]         = useState<HonorarioV2Row | null>(null);
  const [confirmAcao, setConfirmAcao]       = useState<'pagar' | 'desmarcar' | 'excluir' | null>(null);
  const [forma, setForma]                   = useState<string>('pix');
  const [pending, start]                    = useTransition();

  useEffect(() => { setRows(initial); }, [initial]);

  const filtrados = rows.filter(r => {
    if (filtroStatus && statusHonorario(r) !== filtroStatus) return false;
    if (filtroCompetencia && mesCurto(r.mes_referencia) !== filtroCompetencia) return false;
    return true;
  });

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual  = Math.min(pagina, totalPaginas);
  const paginados    = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  function fecharConfirm() { setConfirmRow(null); setConfirmAcao(null); }

  function confirmarAcao() {
    if (!confirmRow || !confirmAcao) return;
    if (confirmAcao === 'pagar') {
      start(async () => {
        const res = await marcarPagoV2Action(confirmRow.id, forma);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Honorário marcado como pago.');
          setRows(rs => rs.map(r => r.id === confirmRow.id
            ? { ...r, data_pagamento: new Date().toISOString().slice(0, 10), forma_pagamento: forma }
            : r));
        } else { toast('error', res.error); }
      });
    } else if (confirmAcao === 'desmarcar') {
      start(async () => {
        const res = await desmarcarPagoV2Action(confirmRow.id);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Pagamento desfeito.');
          setRows(rs => rs.map(r => r.id === confirmRow.id ? { ...r, data_pagamento: null, forma_pagamento: null } : r));
        } else { toast('error', res.error); }
      });
    } else {
      start(async () => {
        const res = await deleteHonorarioV2Action(confirmRow.id);
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

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filtroStatus}
          onChange={e => { setFiltroStatus(e.target.value as StatusHonorario | ''); setPagina(1); }}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="aberto">Aberto</option>
          <option value="atrasado">Atrasado</option>
          <option value="pago">Pago</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Competência
          <input
            type="month"
            value={filtroCompetencia}
            onChange={e => { setFiltroCompetencia(e.target.value); setPagina(1); }}
            className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          />
        </label>
        {filtroCompetencia && (
          <button type="button" onClick={() => { setFiltroCompetencia(''); setPagina(1); }}
            className="text-xs text-muted-foreground hover:text-foreground">
            ✕
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
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
      </div>

      {/* ── Tabela ── */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum honorário encontrado.
        </div>
      ) : (
        <>
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
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Recorrente</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginados.map(r => {
                  const st = statusHonorario(r);
                  return (
                    <tr key={r.id} className="bg-surface hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{r.companies?.nome || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{mesLabel(r.mes_referencia)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(valorToCentavos(r.valor))}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_vencimento)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[st]}`}>
                          {STATUS_LABEL[st]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.recorrente ? `✓ dia ${r.recorrencia_dia}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {st !== 'pago' ? (
                            <button onClick={() => { setConfirmRow(r); setConfirmAcao('pagar'); setForma('pix'); }} disabled={pending}
                              title="Marcar como pago" className="text-success hover:opacity-70 disabled:opacity-40">
                              <CheckCircle className="size-4" />
                            </button>
                          ) : (
                            <button onClick={() => { setConfirmRow(r); setConfirmAcao('desmarcar'); }} disabled={pending}
                              title="Desmarcar pagamento" className="text-alert hover:opacity-70 disabled:opacity-40">
                              <XCircle className="size-4" />
                            </button>
                          )}
                          <button onClick={() => { setEditing(r); setShowForm(true); }}
                            title="Editar" className="text-muted-foreground hover:text-foreground">
                            <Pencil className="size-4" />
                          </button>
                          <button onClick={() => { setConfirmRow(r); setConfirmAcao('excluir'); }} disabled={pending}
                            title="Excluir" className="text-destructive hover:opacity-70 disabled:opacity-40">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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

      <HonorarioV2FormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(undefined); }}
        clientes={clientes}
        editing={editing}
      />

      <PopupConfirm
        open={confirmAcao === 'pagar'}
        title="Confirmar pagamento"
        description={`Marcar honorário de ${confirmRow ? formatBRL(valorToCentavos(confirmRow.valor)) : ''} como pago?`}
        confirmLabel="Marcar como pago"
        cancelLabel="Cancelar"
        variant="primary"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      >
        <label className="block text-sm text-muted-foreground-2">
          Forma de pagamento
          <select
            value={forma}
            onChange={e => setForma(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          >
            {FORMAS_PAGAMENTO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </PopupConfirm>

      <PopupConfirm
        open={confirmAcao === 'desmarcar'}
        title="Desmarcar pagamento"
        description="Este honorário volta para pendente/aberto."
        confirmLabel="Desmarcar"
        cancelLabel="Cancelar"
        variant="primary"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      />

      <PopupConfirm
        open={confirmAcao === 'excluir'}
        title="Excluir honorário"
        description={`Tem certeza que deseja excluir o honorário de ${confirmRow ? formatBRL(valorToCentavos(confirmRow.valor)) : ''}? Esta ação não pode ser desfeita.`}
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
