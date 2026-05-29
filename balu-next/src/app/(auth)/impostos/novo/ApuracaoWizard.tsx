'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { iniciarApuracaoAction, type ApuracaoResult } from '../actions';
import { competenciaLabel, brl } from '@/lib/fiscal/guia';

export default function ApuracaoWizard({ competenciaDefault }: { competenciaDefault: string }) {
  const router = useRouter();
  const [competencia, setCompetencia] = useState(competenciaDefault);
  const [preview, setPreview] = useState<Extract<ApuracaoResult, { ok: true }>['resultado'] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function calcular() {
    setErro(null);
    startTransition(async () => {
      const r = await iniciarApuracaoAction(competencia, 'preview');
      if (r.ok) { setPreview(r.resultado); } else { setErro(r.error); setPreview(null); }
    });
  }

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r = await iniciarApuracaoAction(competencia, 'commit');
      if (r.ok) { router.push('/impostos'); } else { setErro(r.error); }
    });
  }

  return (
    <div className="space-y-6">
      {/* Passo 1: competência */}
      <div className="rounded-lg border border-zinc-200 p-4">
        <label className="block text-sm font-medium text-zinc-700">Competência (YYYYMM)</label>
        <input
          value={competencia}
          onChange={(e) => {
            setCompetencia(e.target.value.replace(/\D/g, '').slice(0, 6));
            setPreview(null);
          }}
          className="mt-1 w-40 rounded border border-zinc-300 px-3 py-2 font-mono"
          inputMode="numeric"
        />
        <p className="mt-1 text-xs text-zinc-500">{competenciaLabel(competencia)}</p>
        <button
          onClick={calcular}
          disabled={pending || competencia.length !== 6}
          className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* Passo 2: preview + confirmar */}
      {preview && (
        <div className="rounded-lg border border-zinc-200 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-800">{preview.tipoApuracao}</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-zinc-500">Receita do mês</dt><dd className="text-right">{brl(preview.receitaMes)}</dd>
            {preview.rbt12 != null && (<><dt className="text-zinc-500">RBT12</dt><dd className="text-right">{brl(preview.rbt12)}</dd></>)}
            {preview.aliquotaEfetiva != null && (<><dt className="text-zinc-500">Alíquota efetiva</dt><dd className="text-right">{(preview.aliquotaEfetiva * 100).toFixed(2)}%</dd></>)}
            <dt className="font-medium text-zinc-700">Imposto</dt><dd className="text-right font-semibold">{brl(preview.valorImposto)}</dd>
          </dl>
          <button
            onClick={confirmar}
            disabled={pending}
            className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Salvando…' : 'Confirmar apuração'}
          </button>
        </div>
      )}
    </div>
  );
}
