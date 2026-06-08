'use client';
// @custom — Dropdown "Nova nota": abre o modal de emissão ou o de nota manual.
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FilePlus, FileText } from 'lucide-react';
import EmitirNotaDialog from './_nova-nota/EmitirNotaDialog';
import NotaManualDialog from './_nova-nota/NotaManualDialog';

export default function NovaNotaDropdown() {
  const [open, setOpen] = useState(false);
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          Nova nota <ChevronDown className="size-4" />
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            <button type="button" onClick={() => { setOpen(false); setEmitirOpen(true); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2">
              <FileText className="size-4 text-primary" /> Emitir NF
            </button>
            <button type="button" onClick={() => { setOpen(false); setManualOpen(true); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 border-t border-border">
              <FilePlus className="size-4 text-muted-foreground" /> Nota manual
            </button>
          </div>
        )}
      </div>
      <EmitirNotaDialog open={emitirOpen} onClose={() => setEmitirOpen(false)} />
      <NotaManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />
    </>
  );
}
