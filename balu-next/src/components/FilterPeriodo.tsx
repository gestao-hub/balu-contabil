'use client';

// Origem: reusable Bubble `Filter_periodo` (Group + GroupFocus popover).
// Estrutura: botão com ícone "filter_alt" que abre um GroupFocus (popover) com
// dois DateInput (Data inicial / Data final) + botões "Aplicar filtro" e "Limpar".
// Workflows Bubble: ToggleElement (botão filtro), SetCustomState + HideElement
// (Aplicar e Limpar). States: `data_inicial_`, `data_final_`. Custom event `Filtered(start,end)`.

import { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';

export type PeriodoRange = { start: string | null; end: string | null };

export type FilterPeriodoProps = {
  /** Disparado quando o usuário aplica ou limpa o filtro. */
  onChange: (range: PeriodoRange) => void;
  /** Valor inicial — útil para reidratar de URL state. */
  initial?: PeriodoRange;
  /** Rótulo do botão acessível. */
  ariaLabel?: string;
};

export default function FilterPeriodo({
  onChange,
  initial,
  ariaLabel = 'Filtrar por período',
}: FilterPeriodoProps) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string>(initial?.start ?? '');
  const [end, setEnd] = useState<string>(initial?.end ?? '');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function apply() {
    onChange({ start: start || null, end: end || null });
    setOpen(false);
  }
  function clear() {
    setStart('');
    setEnd('');
    onChange({ start: null, end: null });
    setOpen(false);
  }

  const hasValue = Boolean(start || end);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`grid size-10 place-items-center rounded-lg border transition-colors ${
          hasValue
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-zinc-200 bg-white text-zinc-600 hover:border-primary hover:text-primary'
        }`}
      >
        <Filter className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-5 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-navy">Filtrar por período</h3>
            <button type="button" aria-label="Fechar" onClick={() => setOpen(false)}>
              <X className="size-4 text-zinc-400 hover:text-zinc-700" />
            </button>
          </div>

          <label className="block text-xs text-zinc-600">
            Data inicial
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="mt-3 block text-xs text-zinc-600">
            Data final
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              min={start || undefined}
              className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={!start && !end}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Aplicar filtro
            </button>
            <button
              type="button"
              onClick={clear}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
