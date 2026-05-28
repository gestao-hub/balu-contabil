'use client';
// @custom — PR 2.1 — Combobox simples pra escolher cliente (tomador).
// Filtra client-side (até 500 clientes — limite no SSR). Sem dep externa.
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

export type ClienteOption = {
  id: string;
  razao_social: string;
  document: string;
  person_type: string;
};

type Props = {
  clientes: ClienteOption[];
  value: string;
  onChange: (id: string) => void;
};

function maskDoc(doc: string): string {
  const d = doc.replace(/\D+/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

export default function ClienteCombobox({ clientes, value, onChange }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clientes.slice(0, 20);
    const onlyDigits = needle.replace(/\D+/g, '');
    return clientes.filter((c) => {
      if (c.razao_social.toLowerCase().includes(needle)) return true;
      if (onlyDigits && c.document.replace(/\D+/g, '').includes(onlyDigits)) return true;
      return false;
    }).slice(0, 50);
  }, [q, clientes]);

  const selected = clientes.find((c) => c.id === value);

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-800 truncate">{selected.razao_social}</p>
          <p className="text-xs text-zinc-500 font-mono">{maskDoc(selected.document)} · {selected.person_type}</p>
        </div>
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(true); setQ(''); }}
          className="text-xs text-zinc-500 hover:text-zinc-700"
          aria-label="Trocar cliente"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (clientes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm text-zinc-500">
        Você ainda não cadastrou clientes. Vá em <span className="font-medium">Clientes</span> para adicionar.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar por nome ou CPF/CNPJ…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      {open && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">Nenhum cliente encontrado.</li>
          )}
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); setQ(''); }}
                className="w-full text-left px-3 py-2 hover:bg-zinc-50"
              >
                <p className="text-sm font-medium text-zinc-800">{c.razao_social}</p>
                <p className="text-xs text-zinc-500 font-mono">{maskDoc(c.document)} · {c.person_type}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
