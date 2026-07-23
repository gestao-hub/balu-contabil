'use client';
// @custom — Campo de data em dd-mm-aaaa (manual). Mostra/edita dd-mm-aaaa mas
// expõe o valor em ISO 'YYYY-MM-DD' (o que lancarNotaManualAction espera).
// Enquanto a data estiver incompleta, onChange devolve '' (submit barra na validação).
import { useState } from 'react';

function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function brToIso(br: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function maskBr(raw: string): string {
  const d = raw.replace(/\D+/g, '').slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += `-${d.slice(2, 4)}`;
  if (d.length > 4) out += `-${d.slice(4, 8)}`;
  return out;
}

export default function DataEmissaoBR({
  value,
  onChange,
  id,
}: {
  value: string; // ISO 'YYYY-MM-DD'
  onChange: (iso: string) => void;
  id?: string;
}) {
  const [texto, setTexto] = useState(() => isoToBr(value));
  return (
    <input
      id={id}
      inputMode="numeric"
      value={texto}
      onChange={(e) => {
        const m = maskBr(e.target.value);
        setTexto(m);
        onChange(brToIso(m));
      }}
      placeholder="dd-mm-aaaa"
      maxLength={10}
      className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
    />
  );
}
