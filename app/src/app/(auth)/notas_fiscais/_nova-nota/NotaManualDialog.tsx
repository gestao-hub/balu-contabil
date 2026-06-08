'use client';
// @custom — Modal de lançamento manual de NF (escolhe tipo → form). Sem Focus.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, FileText, Package, ShoppingCart, Loader2 } from 'lucide-react';
import { prepararNotaManualAction } from '../actions';
import type { ClienteOption } from './ClienteCombobox';
import NotaManualForm from './NotaManualForm';

type Tipo = 'NFSe' | 'NFe' | 'NFCe';
const CARDS: { key: Tipo; titulo: string; sub: string; Icon: typeof FileText }[] = [
  { key: 'NFSe', titulo: 'NFS-e', sub: 'Serviço', Icon: FileText },
  { key: 'NFe', titulo: 'NF-e', sub: 'Produto (modelo 55)', Icon: Package },
  { key: 'NFCe', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', Icon: ShoppingCart },
];
const LABEL: Record<Tipo, string> = { NFSe: 'NFS-e', NFe: 'NF-e', NFCe: 'NFC-e' };

export default function NotaManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteOption[] | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Ao abrir: reseta o passo e carrega os clientes (lançamento manual não tem
  // travas de habilitação — os 3 tipos ficam sempre disponíveis).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setClientes(null);
    setTipo(null);
    prepararNotaManualAction().then((r) => { if (!cancelled) setClientes(r.clientes); });
    return () => { cancelled = true; };
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
          <div className="flex items-center gap-2">
            {tipo && (
              <button type="button" onClick={() => setTipo(null)} aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" />
              </button>
            )}
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Lançar nota manual{tipo ? ` · ${LABEL[tipo]}` : ''}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>

        <div className="px-6 py-5">
          {clientes === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : !tipo ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">Escolha o tipo de documento.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CARDS.map(({ key, titulo, sub, Icon }) => (
                  <button key={key} type="button" onClick={() => setTipo(key)}
                    className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2 text-left">
                    <span className="text-primary"><Icon className="size-6" /></span>
                    <span className="font-medium text-foreground">{titulo}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <NotaManualForm tipo={tipo} clientes={clientes} onSuccess={sucesso} />
          )}
        </div>
      </div>
    </dialog>
  );
}
