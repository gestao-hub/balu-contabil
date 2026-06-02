'use client';

// Origem: reusable Bubble `PU_padrao` (PRD §6.9 — popup template Cancel/Reset/Confirm).
// O reusable original não tem UI explícita no tree (plugin externo); reconstruído
// como <dialog> nativo com Tailwind + ações tipadas.

import { type ReactNode, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export type PopupConfirmProps = {
  open: boolean;
  title: string;
  description?: string;
  /** Texto do botão de confirmação. */
  confirmLabel?: string;
  /** Texto do botão de cancelamento. */
  cancelLabel?: string;
  /** Variante visual: 'destructive' para deleções, 'primary' para neutras. */
  variant?: 'primary' | 'destructive';
  /** Ação executada ao confirmar. Pode ser async — o botão fica desabilitado durante. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  /** Se true, mostra spinner no botão Confirmar e bloqueia interação. */
  busy?: boolean;
  /** Conteúdo extra renderizado entre a descrição e os botões (ex.: um campo de justificativa). */
  children?: ReactNode;
};

export default function PopupConfirm({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'primary',
  onConfirm,
  onCancel,
  busy = false,
  children,
}: PopupConfirmProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="popup-confirm-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      className="rounded-xl border border-border bg-surface p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(420px,90vw)] p-6">
        <div className="flex items-start gap-3">
          {variant === 'destructive' && (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" />
            </span>
          )}
          <div className="flex-1">
            <h2 id="popup-confirm-title" className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground-2">{description}</p>
            )}
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              variant === 'destructive' ? 'bg-destructive hover:opacity-90' : 'bg-primary hover:opacity-90'
            }`}
          >
            {busy ? 'Processando…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
