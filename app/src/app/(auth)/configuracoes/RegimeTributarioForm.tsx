'use client';
// @custom — PR 1.4: aba "Regime tributário" das Configurações (PRD §8).
// Abre em modo leitura (campos bloqueados + botão "Editar"); ao editar, o footer
// vira "Salvar" + "Cancelar". Cancelar reverte aos últimos valores; salvar re-bloqueia.
import { useState } from 'react';
import { Loader2, Save, Pencil } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import {
  REGIME_OPTIONS, FAIXA_OPTIONS, ATIVIDADE_MEI_OPTIONS,
  isMei, anexoFromFaixa, faixaFromAnexo, fatorRAplicavel, type RegimeCode, type AtividadeMei,
} from '@/lib/fiscal/regime';
import { upsertEmpresaFiscalAction } from './actions';
import { formatCnae } from '@/lib/format/masks';
import type { CnaeSecundario } from '@/lib/fiscal/company-cnaes';

type Initial = {
  Code_regime_tributario?: string | null;
  anexo_simples?: string | null;
  usa_fator_r?: boolean | null;
  cnae_principal?: string | null;
  atividade_mei?: string | null;
};

export default function RegimeTributarioForm({
  initial,
  cnaesSecundarios = [],
}: {
  initial: Initial | null;
  cnaesSecundarios?: CnaeSecundario[];
}) {
  const toast = useToast();
  const [code, setCode] = useState<string>(initial?.Code_regime_tributario ?? '');
  const [faixa, setFaixa] = useState<string>(faixaFromAnexo(initial?.anexo_simples ?? null) ?? '');
  const [fatorR, setFatorR] = useState<boolean>(!!initial?.usa_fator_r);
  const [cnae, setCnae] = useState<string>(initial?.cnae_principal ?? '');
  const [atividadeMei, setAtividadeMei] = useState<string>(initial?.atividade_mei ?? '');
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
    setAtividadeMei(initial?.atividade_mei ?? '');
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
        cnae_principal: cnae.replace(/\D+/g, '') || null,
        atividade_mei: mei ? ((atividadeMei as AtividadeMei) || null) : null,
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
        <span className="text-xs font-medium text-muted-foreground-2">Regime tributário</span>
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={locked}
          className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
        >
          <option value="">Selecione…</option>
          {REGIME_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>{o.label}</option>
          ))}
        </select>
      </label>

      {!mei && (
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Faixa de atividade econômica</span>
          <select
            value={faixa}
            onChange={(e) => setFaixa(e.target.value)}
            disabled={locked}
            className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
          >
            <option value="">Selecione…</option>
            {FAIXA_OPTIONS.map((o) => (
              <option key={o.anexo} value={o.label}>{o.label} ({o.anexo})</option>
            ))}
          </select>
        </label>
      )}

      {mei && (
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Atividade do MEI</span>
          <select
            value={atividadeMei}
            onChange={(e) => setAtividadeMei(e.target.value)}
            disabled={locked}
            className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
          >
            <option value="">Selecione…</option>
            {ATIVIDADE_MEI_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Define o valor estimado do DAS-MEI (ICMS e/ou ISS).</span>
        </label>
      )}

      {mostraFatorR && (
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fatorR}
            onChange={(e) => setFatorR(e.target.checked)}
            disabled={locked}
            className="size-4 rounded border-border disabled:opacity-50"
          />
          <span className="text-muted-foreground-2">Usa Fator R (serviços — Anexo III/V)</span>
        </label>
      )}

      <label className="col-span-2 flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">CNAE principal</span>
        <input
          type="text"
          value={formatCnae(cnae)}
          onChange={(e) => setCnae(formatCnae(e.target.value))}
          placeholder="0000-0/00"
          disabled={locked}
          className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
        />
      </label>

      {/* CNAEs secundários — read-only (vêm do sync da Receita no cadastro); nunca editáveis aqui. */}
      <div className="col-span-2 flex flex-col gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">CNAEs secundários</span>
        {cnaesSecundarios.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum CNAE secundário registrado.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {cnaesSecundarios.map((c) => (
              <li
                key={c.codigo}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
              >
                <span className="min-w-0 truncate text-muted-foreground-2">
                  <span className="font-medium text-foreground">{formatCnae(c.codigo)}</span>
                  {c.descricao ? <span className="text-muted-foreground"> — {c.descricao}</span> : null}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.anexoLabel ? 'bg-surface text-muted-foreground-2' : 'bg-alert/10 text-alert'
                  }`}
                >
                  {c.anexoLabel ?? 'a curar'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <span className="text-xs text-muted-foreground">Vêm da Receita (consulta do CNPJ) e não são editáveis aqui.</span>
      </div>

      <div className="col-span-2 mt-2 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
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
