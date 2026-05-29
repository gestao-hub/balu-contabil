'use client';

// Origem: equivalente do reusable Bubble `Mensageria` (custom event Trigger_BEP
// disparando alerts Success/Error por 3s — ver PRD §6.3).
// No Bubble este nome aparece em 2 reusables (`Mensageria` e `loading`/`Loading`);
// aqui consolidamos só o sistema de toasts.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastCtx = {
  push: (kind: ToastKind, message: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <Toaster toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx.push;
}

type ToasterProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

const STYLES: Record<ToastKind, { wrap: string; Icon: React.ComponentType<{ className?: string }> }> = {
  success: { wrap: 'bg-success text-white', Icon: CheckCircle2 },
  error:   { wrap: 'bg-destructive text-white', Icon: AlertCircle },
  info:    { wrap: 'bg-primary text-white', Icon: Info },
  warning: { wrap: 'bg-alert text-white', Icon: AlertTriangle },
};

export default function Toaster({ toasts, onDismiss }: ToasterProps) {
  const ref = useRef<HTMLDivElement>(null);

  // <dialog> aberto via showModal() vive na "top layer" do navegador, acima de
  // QUALQUER z-index do DOM normal — então um toast com z-50 ficava atrás do
  // backdrop do modal. Promovemos o container de toasts à top layer via Popover
  // API para ele sempre pintar acima (inclusive de modais abertos). Re-promove
  // a cada novo toast para ficar acima de modais abertos depois dele.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
    } catch {
      /* já fechado */
    }
    if (toasts.length > 0) {
      try {
        el.showPopover();
      } catch {
        /* navegador sem suporte a Popover API → cai no fixed z-50 normal */
      }
    }
  }, [toasts]);

  return (
    <div
      ref={ref}
      popover="manual"
      role="region"
      aria-live="polite"
      aria-label="Notificações"
      className="fixed inset-auto bottom-4 right-4 z-50 m-0 flex flex-col gap-2 border-0 bg-transparent p-0"
    >
      {toasts.map((t) => {
        const { wrap, Icon } = STYLES[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-md min-w-[280px] ${wrap}`}
          >
            <Icon className="size-5 shrink-0" />
            <p className="text-sm flex-1">{t.message}</p>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => onDismiss(t.id)}
              className="opacity-80 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
