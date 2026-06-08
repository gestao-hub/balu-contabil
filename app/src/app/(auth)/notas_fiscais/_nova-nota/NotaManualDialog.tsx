'use client';
// @custom — Modal de lançamento manual de NF (registro de nota emitida fora).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { prepararNotaManualAction } from '../actions';
import type { ClienteOption } from './ClienteCombobox';
import NotaManualForm from './NotaManualForm';

export default function NotaManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteOption[] | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setClientes(null);
    prepararNotaManualAction().then((r) => setClientes(r.clientes));
  }, [open]);

  function sucesso() { onClose(); router.refresh(); }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="rounded-xl border border-border bg-surface text-foreground p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Lançar nota manual</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>
        <div className="px-6 py-5">
          {clientes === null
            ? <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            : <NotaManualForm clientes={clientes} onSuccess={sucesso} />}
        </div>
      </div>
    </dialog>
  );
}
