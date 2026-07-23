'use client';
import { useState, useEffect, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toaster';
import { createHonorarioV2Action, updateHonorarioV2Action } from './actions';

export type ClienteOption = { id: string; nome: string };

export type HonorarioV2Row = {
  id: string;
  empresa_cliente_id: string;
  mes_referencia: string; // YYYY-MM-DD (sempre dia 01)
  valor: string;          // decimal string (numeric do Postgres)
  data_vencimento: string;
  data_pagamento: string | null;
  observacao: string | null;
  forma_pagamento: string | null;
  recorrente: boolean;
  recorrencia_dia: number | null;
  companies: { nome: string | null; cnpj: string | null } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  clientes: ClienteOption[];
  editing?: HonorarioV2Row;
};

/** YYYY-MM-DD → YYYY-MM (para <input type="month">) */
function mesCurto(d: string): string {
  return d ? d.slice(0, 7) : '';
}

export default function HonorarioV2FormDialog({ open, onClose, clientes, editing }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [recorrente, setRecorrente] = useState(false);

  // Sincroniza o estado do checkbox quando o dialog abre com um honorário diferente.
  useEffect(() => {
    setErro(null);
    setRecorrente(editing?.recorrente ?? false);
  }, [open, editing?.id]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      empresa_cliente_id: String(fd.get('empresa_cliente_id') ?? ''),
      valor: String(fd.get('valor') ?? '').trim(),
      mes_referencia: String(fd.get('mes_referencia') ?? ''),
      data_vencimento: String(fd.get('data_vencimento') ?? ''),
      observacao: String(fd.get('observacao') ?? '') || undefined,
      recorrente,
      recorrencia_dia: recorrente ? Number(fd.get('recorrencia_dia') ?? '') : undefined,
    };

    start(async () => {
      const res = editing
        ? await updateHonorarioV2Action(editing.id, input)
        : await createHonorarioV2Action(input);

      if (res.ok) {
        toast('success', editing ? 'Honorário atualizado.' : 'Honorário criado.');
        router.refresh();
        onClose();
      } else {
        setErro(res.error);
      }
    });
  }

  const cls = 'w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-md">
        <h2 className="font-semibold text-foreground mb-4">
          {editing ? 'Editar honorário' : 'Novo honorário'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-muted-foreground-2">
            Cliente *
            <select name="empresa_cliente_id" required defaultValue={editing?.empresa_cliente_id ?? ''} className={cls + ' mt-1'}>
              <option value="">Selecione…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Competência *
            <input
              name="mes_referencia"
              type="month"
              required
              defaultValue={editing ? mesCurto(editing.mes_referencia) : ''}
              className={cls + ' mt-1'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Valor (R$) *
            <input
              name="valor"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              required
              defaultValue={editing?.valor ?? ''}
              className={cls + ' mt-1'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Vencimento *
            <input
              name="data_vencimento"
              type="date"
              required
              defaultValue={editing?.data_vencimento ?? ''}
              className={cls + ' mt-1'}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={recorrente}
              onChange={e => setRecorrente(e.target.checked)}
              className="accent-primary"
            />
            Recorrente (repete todo mês)
          </label>

          {recorrente && (
            <label className="block text-sm text-muted-foreground-2">
              Dia da recorrência (1–28) *
              <input
                name="recorrencia_dia"
                type="number"
                min={1}
                max={28}
                required={recorrente}
                defaultValue={editing?.recorrencia_dia ?? ''}
                className={cls + ' mt-1'}
              />
            </label>
          )}

          <label className="block text-sm text-muted-foreground-2">
            Observação
            <textarea
              name="observacao"
              rows={2}
              defaultValue={editing?.observacao ?? ''}
              className={cls + ' mt-1 resize-none'}
            />
          </label>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={pending}
              className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-surface-2 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={pending}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50">
              {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
