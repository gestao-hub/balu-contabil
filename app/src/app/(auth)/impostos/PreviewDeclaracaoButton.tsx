'use client';

import { useState, useTransition } from 'react';
import { FileSearch } from 'lucide-react';
import { previewDeclaracaoAction, type PreviewDeclaracaoResult } from './actions';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PreviewDeclaracaoButton({ competencia }: { competencia: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PreviewDeclaracaoResult | null>(null);

  function run() {
    setRes(null);
    start(async () => setRes(await previewDeclaracaoAction(competencia)));
  }

  return (
    <div className="mt-3">
      <button
        type="button" onClick={run} disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
      >
        <FileSearch className="size-4" />
        {pending ? 'Calculando na Receita…' : 'Pré-visualizar declaração (dry-run)'}
      </button>

      {res && res.ok && (
        <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Valores calculados pela Receita {res.result.transmitida ? '' : '— nada foi transmitido'}
          </p>
          {res.result.valorTotalDevido != null && (
            <p className="font-semibold tabular-nums">Total devido: {brl(res.result.valorTotalDevido)}</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {res.result.tributos.map((t) => (
              <li key={t.codigo} className="flex justify-between tabular-nums">
                <span className="text-muted-foreground-2">{t.nome}</span><span>{brl(t.valor)}</span>
              </li>
            ))}
          </ul>
          {res.result.mensagens.length > 0 && (
            <ul className="mt-2 text-xs text-muted-foreground list-disc pl-4">
              {res.result.mensagens.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}
      {res && !res.ok && (
        <p className="mt-2 text-sm text-red-600">{res.error}</p>
      )}
    </div>
  );
}
