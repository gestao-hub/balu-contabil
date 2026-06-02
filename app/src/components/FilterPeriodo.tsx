'use client';

// Origem: reusable Bubble `Filter_periodo` (Group + GroupFocus popover).
// Estrutura: botão com ícone "filter_alt" que abre um GroupFocus (popover) com
// dois DateInput (Data inicial / Data final) + botões "Aplicar filtro" e "Limpar".
// Workflows Bubble: ToggleElement (botão filtro), SetCustomState + HideElement
// (Aplicar e Limpar). States: `data_inicial_`, `data_final_`. Custom event `Filtered(start,end)`.

import { useEffect, useRef, useState } from 'react';
import { Filter, X, Calendar } from 'lucide-react';

export type PeriodoRange = { start: string | null; end: string | null };

export type FilterPeriodoProps = {
  /** Disparado quando o usuário aplica ou limpa o filtro. */
  onChange: (range: PeriodoRange) => void;
  /** Valor inicial — start/end em ISO (YYYY-MM-DD). */
  initial?: PeriodoRange;
  /** Rótulo do botão acessível. */
  ariaLabel?: string;
};

// ─── helpers de conversão de data ────────────────────────────────────────────
function isoToBR(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function brToISO(br: string): string {
  if (!br || !br.includes('/')) return '';
  const [d, m, y] = br.split('/');
  return y && m && d ? `${y}-${m}-${d}` : '';
}
function maskDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// ─── campo de data com máscara + calendário nativo ───────────────────────────
function DateFieldBR({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string; // dd/mm/aaaa
  onChange: (v: string) => void;
  min?: string;  // ISO mínimo para o picker
}) {
  const pickerRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') { el.showPicker(); } else { el.focus(); }
  }

  const isoValue = brToISO(value);

  return (
    <label className="block text-xs text-muted-foreground-2">
      {label}
      <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-surface-2 px-3 py-2">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(maskDate(e.target.value))}
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="flex-1 bg-transparent text-foreground text-sm focus:outline-none font-mono min-w-0"
        />
        <button type="button" onClick={openPicker} title="Abrir calendário"
          className="text-muted-foreground hover:text-foreground shrink-0">
          <Calendar className="size-3.5" />
        </button>
        <input
          ref={pickerRef}
          type="date"
          value={isoValue}
          min={min}
          onChange={e => onChange(isoToBR(e.target.value))}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </label>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────
export default function FilterPeriodo({
  onChange,
  initial,
  ariaLabel = 'Filtrar por período',
}: FilterPeriodoProps) {
  const [open, setOpen]   = useState(false);
  const [start, setStart] = useState<string>(isoToBR(initial?.start ?? ''));
  const [end, setEnd]     = useState<string>(isoToBR(initial?.end ?? ''));
  const rootRef           = useRef<HTMLDivElement>(null);

  // Sincroniza com prop initial quando muda (ex: estado inicial do mês)
  useEffect(() => {
    setStart(isoToBR(initial?.start ?? ''));
    setEnd(isoToBR(initial?.end ?? ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.start, initial?.end]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function apply() {
    onChange({ start: brToISO(start) || null, end: brToISO(end) || null });
    setOpen(false);
  }
  function clear() {
    setStart(''); setEnd('');
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
            : 'border-border bg-surface text-muted-foreground-2 hover:border-primary hover:text-primary'
        }`}
      >
        <Filter className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-surface p-5 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Filtrar por período</h3>
            <button type="button" aria-label="Fechar" onClick={() => setOpen(false)}>
              <X className="size-4 text-muted-foreground hover:text-muted-foreground-2" />
            </button>
          </div>

          <DateFieldBR
            label="Data inicial"
            value={start}
            onChange={setStart}
          />

          <div className="mt-3">
            <DateFieldBR
              label="Data final"
              value={end}
              onChange={setEnd}
              min={brToISO(start) || undefined}
            />
          </div>

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
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2"
            >
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
