'use client';
// @custom — PR 1.3: botão de cancelar nota + confirmação destrutiva com justificativa (SEFAZ ≥15).
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { validarJustificativa } from '@/lib/fiscal/notas-tipo';
import { cancelarNotaAction } from '../actions';

export default function CancelarButton({ id, ativa }: { id: string; ativa: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [busy, setBusy] = useState(false);

  async function doCancel() {
    const v = validarJustificativa(justificativa);
    if (!v.ok) { toast('warning', v.error); return; }
    setBusy(true);
    try {
      const r = await cancelarNotaAction(id, justificativa);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Nota cancelada.');
      setOpen(false);
      setJustificativa('');
    } catch {
      toast('error', 'Erro inesperado ao cancelar.');
    } finally {
      setBusy(false);
    }
  }

  if (!ativa) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-destructive px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5"
      >
        <Ban className="size-4" />
        Cancelar nota
      </button>

      <PopupConfirm
        open={open}
        variant="destructive"
        title="Cancelar esta nota fiscal?"
        description="O cancelamento é enviado à SEFAZ e é irreversível. Informe a justificativa (mínimo 15 caracteres)."
        confirmLabel="Cancelar nota"
        cancelLabel="Voltar"
        busy={busy}
        onConfirm={doCancel}
        onCancel={() => setOpen(false)}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-zinc-600">Justificativa (mín. 15 caracteres)</span>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={3}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
      </PopupConfirm>
    </>
  );
}
