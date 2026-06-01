'use client';
import { useState, useEffect, useTransition } from 'react';
import { useToast } from '@/components/Toaster';
import { Plus, CheckCircle, Pencil, Trash2 } from 'lucide-react';
import { marcarPagoAction, deleteHonorarioAction } from './actions';
import HonorarioFormDialog, { type ClienteOption, type HonorarioRow } from './HonorarioFormDialog';
import PopupConfirm from '@/components/PopupConfirm';

export type { HonorarioRow };

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

type Props = {
  initial: HonorarioRow[];
  companyId: string;
  clientes: ClienteOption[];
};

export default function HonorarioList({ initial, companyId, clientes }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus]   = useState('');
  const [filtroMes, setFiltroMes]         = useState('');
  const [showForm, setShowForm]           = useState(false);
  const [editing, setEditing]             = useState<HonorarioRow | undefined>();
  const [confirmRow, setConfirmRow]       = useState<HonorarioRow | null>(null);
  const [confirmAcao, setConfirmAcao]     = useState<'pagar' | 'excluir' | null>(null);
  const [pending, start]                  = useTransition();

  // Sincroniza estado local quando o Server Component re-envia novos dados (após router.refresh)
  useEffect(() => { setRows(initial); }, [initial]);

  const filtrados = rows.filter(r => {
    if (filtroCliente && r.cliente_id !== filtroCliente) return false;
    if (filtroStatus  && r.status     !== filtroStatus)  return false;
    if (filtroMes     && !r.mes_referencia.startsWith(filtroMes)) return false;
    return true;
  });

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
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filtroCliente}
          onChange={e => setFiltroCliente(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="atrasado">Atrasado</option>
        </select>

        <input
          type="month"
          value={filtroMes}
          onChange={e => setFiltroMes(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        />

        <button
          onClick={() => { setEditing(undefined); setShowForm(true); }}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" />
          Novo honorário
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum honorário encontrado.
        </div>
      ) : (
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
              {filtrados.map(r => (
                <tr key={r.id} className="bg-surface hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {r.clientes?.razao_social || '—'}
                  </td>
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
                        <button
                          onClick={() => { setConfirmRow(r); setConfirmAcao('pagar'); }}
                          disabled={pending}
                          title="Marcar como pago"
                          className="text-success hover:opacity-70 disabled:opacity-40"
                        >
                          <CheckCircle className="size-4" />
                        </button>
                      )}
                      {r.status !== 'pago' && (
                        <button
                          onClick={() => { setEditing(r); setShowForm(true); }}
                          title="Editar"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-4" />
                        </button>
                      )}
                      <button
                        onClick={() => { setConfirmRow(r); setConfirmAcao('excluir'); }}
                        disabled={pending}
                        title="Excluir"
                        className="text-destructive hover:opacity-70 disabled:opacity-40"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
