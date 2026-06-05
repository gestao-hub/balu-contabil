'use client';

import { useState, useTransition } from 'react';
import { salvarFolhaAction, type FolhaInput } from '../actions';

export type FolhaRow = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

function rotulo(competencia: string): string {
  return `${competencia.slice(4, 6)}/${competencia.slice(0, 4)}`;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function FolhaGrid({ initialRows }: { initialRows: FolhaRow[] }) {
  const [rows, setRows] = useState<FolhaRow[]>(initialRows);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  function setCampo(idx: number, campo: keyof Omit<FolhaRow, 'competencia'>, valor: string) {
    const num = valor === '' ? 0 : Number(valor);
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [campo]: Number.isFinite(num) ? num : 0 } : r)));
  }

  function salvar() {
    setMsg(null);
    const payload: FolhaInput[] = rows.map((r) => ({
      competencia: r.competencia,
      proLabore: r.proLabore,
      salarios: r.salarios,
      encargos: r.encargos,
    }));
    startTransition(async () => {
      const res = await salvarFolhaAction(payload);
      setMsg(res.ok ? { tipo: 'ok', texto: 'Folha salva.' } : { tipo: 'erro', texto: res.error });
    });
  }

  return (
    <div className="mt-6">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 font-medium">Pró-labore</th>
              <th className="px-3 py-2 font-medium">Salários</th>
              <th className="px-3 py-2 font-medium">Encargos</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const total = r.proLabore + r.salarios + r.encargos;
              return (
                <tr key={r.competencia} className="border-t">
                  <td className="px-3 py-2">{rotulo(r.competencia)}</td>
                  {(['proLabore', 'salarios', 'encargos'] as const).map((campo) => (
                    <td key={campo} className="px-2 py-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={r[campo] === 0 ? '' : r[campo]}
                        placeholder="0,00"
                        onChange={(e) => setCampo(idx, campo, e.target.value)}
                        className="w-28 rounded border px-2 py-1 text-right"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{brl(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        {msg && (
          <span className={msg.tipo === 'ok' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  );
}
