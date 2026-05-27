'use client';
// @custom — PR 1.4: aba "Regime tributário" das Configurações (PRD §8).
// Abre em modo leitura (campos bloqueados + botão "Editar"); ao editar, o footer
// vira "Salvar" + "Cancelar". Cancelar reverte aos últimos valores; salvar re-bloqueia.
import { useState } from 'react';
import { Loader2, Save, Pencil } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import {
  REGIME_OPTIONS, FAIXA_OPTIONS,
  isMei, anexoFromFaixa, faixaFromAnexo, fatorRAplicavel, type RegimeCode,
} from '@/lib/fiscal/regime';
import { upsertEmpresaFiscalAction } from './actions';

type Initial = {
  Code_regime_tributario?: string | null;
  anexo_simples?: string | null;
  usa_fator_r?: boolean | null;
  cnae_principal?: string | null;
};

export default function RegimeTributarioForm({ initial }: { initial: Initial | null }) {
  const toast = useToast();
  const [code, setCode] = useState<string>(initial?.Code_regime_tributario ?? '');
  const [faixa, setFaixa] = useState<string>(faixaFromAnexo(initial?.anexo_simples ?? null) ?? '');
  const [fatorR, setFatorR] = useState<boolean>(!!initial?.usa_fator_r);
  const [cnae, setCnae] = useState<string>(initial?.cnae_principal ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const mei = isMei(code);
  const anexo = anexoFromFaixa(faixa);
  const mostraFatorR = !mei && fatorRAplicavel(anexo);
  const locked = !editing;

  function resetFromInitial() {
    setCode(initial?.Code_regime_tributario ?? '');
    setFaixa(faixaFromAnexo(initial?.anexo_simples ?? null) ?? '');
    setFatorR(!!initial?.usa_fator_r);
    setCnae(initial?.cnae_principal ?? '');
  }

  function handleCancel() {
    resetFromInitial();
    setEditing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) { toast('error', 'Selecione o regime tributário.'); return; }
    setBusy(true);
    try {
      const r = await upsertEmpresaFiscalAction({
        Code_regime_tributario: code as RegimeCode,
        anexo_simples: mei ? null : anexo,
        usa_fator_r: mostraFatorR ? fatorR : false,
        cnae_principal: cnae.trim() || null,
      });
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Regime tributário salvo.');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 max-w-2xl">
      <label className="col-span-2 flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">Regime tributário</span>
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={locked}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
        >
          <option value="">Selecione…</option>
          {REGIME_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{o.label}</option>
          ))}
        </select>
      </label>

      {!mei && (
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-zinc-600">Faixa de atividade econômica</span>
          <select
            value={faixa}
            onChange={(e) => setFaixa(e.target.value)}
            disabled={locked}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            <option value="">Selecione…</option>
            {FAIXA_OPTIONS.map((o) => (
              <option key={o.anexo} value={o.label}>{o.label} ({o.anexo})</option>
            ))}
          </select>
        </label>
      )}

      {mostraFatorR && (
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fatorR}
            onChange={(e) => setFatorR(e.target.checked)}
            disabled={locked}
            className="size-4 rounded border-zinc-300 disabled:opacity-50"
          />
          <span className="text-zinc-700">Usa Fator R (serviços — Anexo III/V)</span>
        </label>
      )}

      <label className="col-span-2 flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">CNAE principal</span>
        <input
          type="text"
          value={cnae}
          onChange={(e) => setCnae(e.target.value)}
          placeholder="0000-0/00"
          disabled={locked}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
        />
      </label>

      <div className="col-span-2 mt-2 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Pencil className="size-4" />
            Editar
          </button>
        )}
      </div>
    </form>
  );
}
