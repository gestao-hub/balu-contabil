'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toaster';
import { createHonorarioAction, updateHonorarioAction } from './actions';

export type ClienteOption = { id: string; nome: string };

export type HonorarioRow = {
  id: string;
  cliente_id: string;
  company_id: string;
  mes_referencia: string;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string | null;
  observacao: string | null;
  clientes: { razao_social: string } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  companyId: string;
  clientes: ClienteOption[];
  editing?: HonorarioRow;
};

function dateToMesRef(d: string): string {
  return d.replace(/-/g, '').slice(0, 6);
}

export default function HonorarioFormDialog({ open, onClose, companyId, clientes, editing }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    fd.set('company_id', companyId);

    start(async () => {
      const res = editing
        ? await updateHonorarioAction(editing.id, fd)
        : await createHonorarioAction(fd);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-md">
        <h2 className="font-semibold text-foreground mb-4">
          {editing ? 'Editar honorário' : 'Novo honorário'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-muted-foreground-2">
            Cliente *
            <select name="cliente_id" required defaultValue={editing?.cliente_id ?? ''} className={cls + ' mt-1'}>
              <option value="">Selecione…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Competência (YYYYMM) *
            <input
              name="mes_referencia"
              required
              defaultValue={editing ? dateToMesRef(editing.mes_referencia) : ''}
              placeholder="202606"
              maxLength={6}
              pattern="\d{6}"
              className={cls + ' mt-1 font-mono'}
            />
          </label>

          <label className="block text-sm text-muted-foreground-2">
            Valor (R$) *
            <input
              name="valor"
              type="number"
              step="0.01"
              min="0"
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
    </div>
  );
}
