'use client';

import { useState, useTransition } from 'react';
import { salvarFolhaAction, type FolhaInput } from '../actions';

export type FolhaRow = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

// Estado interno em string para não perder o ponto decimal ao digitar (ex.: "1000.5").
type FolhaDraft = { competencia: string; proLabore: string; salarios: string; encargos: string };

function rotulo(competencia: string): string {
  return `${competencia.slice(4, 6)}/${competencia.slice(0, 4)}`;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Aceita "1000.5" e "1000,5"; vazio/sem número → 0.
function num(s: string): number {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

function toDraft(r: FolhaRow): FolhaDraft {
  return {
    competencia: r.competencia,
    proLabore: r.proLabore === 0 ? '' : String(r.proLabore),
    salarios: r.salarios === 0 ? '' : String(r.salarios),
    encargos: r.encargos === 0 ? '' : String(r.encargos),
  };
}

export function FolhaGrid({ initialRows }: { initialRows: FolhaRow[] }) {
  const [rows, setRows] = useState<FolhaDraft[]>(() => initialRows.map(toDraft));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  function setCampo(idx: number, campo: keyof Omit<FolhaDraft, 'competencia'>, valor: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [campo]: valor } : r)));
  }

  function salvar() {
    setMsg(null);
    const payload: FolhaInput[] = rows.map((r) => ({
      competencia: r.competencia,
      proLabore: num(r.proLabore),
      salarios: num(r.salarios),
      encargos: num(r.encargos),
    }));
    if (payload.some((r) => r.proLabore < 0 || r.salarios < 0 || r.encargos < 0)) {
      setMsg({ tipo: 'erro', texto: 'Valores da folha não podem ser negativos.' });
      return;
    }
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
              const total = num(r.proLabore) + num(r.salarios) + num(r.encargos);
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
                        value={r[campo]}
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
