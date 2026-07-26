// Formulário assistido da DASN-SIMEI: pré-preenche com as notas do ano, deixa
// editar e alerta sobre divergência e teto do MEI — nunca bloqueia (spec §5.2).
'use client';
import { useState } from 'react';
import { brl } from '@/lib/fiscal/guia';
import { avaliarLimiteMei, LIMITE_MEI_ANUAL } from '@/lib/fiscal/dasn/resumo';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import type { ResumoReceitas } from '@/lib/fiscal/declaracoes-anuais/tipos';

export type SalvarDasn = (dados: {
  receitaComercio: number; receitaServico: number; possuiEmpregado: boolean;
}) => Promise<{ ok: boolean; error?: string }>;

export default function DasnAssistidaForm({ resumo, inicial, onSalvar }: {
  resumo: ResumoReceitas;
  inicial: { receitaComercio: number; receitaServico: number; possuiEmpregado: boolean };
  onSalvar: SalvarDasn;
}) {
  const [comercio, setComercio] = useState(inicial.receitaComercio);
  const [servico, setServico] = useState(inicial.receitaServico);
  const [empregado, setEmpregado] = useState(inicial.possuiEmpregado);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const declarado = comercio + servico;
  const divergencia = calcularDivergencia(declarado, resumo.total);
  const limite = avaliarLimiteMei(declarado);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await onSalvar({ receitaComercio: comercio, receitaServico: servico, possuiEmpregado: empregado });
      if (!r.ok) setErro(r.error ?? 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Suas notas de {resumo.qtdNotas === 1 ? '1 nota' : `${resumo.qtdNotas} notas`} somam{' '}
        <strong>{brl(resumo.total)}</strong> — comércio {brl(resumo.comercio)}, serviço {brl(resumo.servico)}.
        Corrija abaixo se for declarar outro valor.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Receita de comércio e indústria" valor={comercio} onChange={setComercio} />
        <Campo label="Receita de serviços" valor={servico} onChange={setServico} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={empregado} onChange={(e) => setEmpregado(e.target.checked)} />
        <span>Teve empregado no ano</span>
      </label>

      <p className="text-sm">Total a declarar: <strong>{brl(declarado)}</strong></p>

      {divergencia.ha && (
        <Alerta tom="warning">
          Você declarou {brl(declarado)}, mas as notas do ano somam {brl(resumo.total)}
          {' '}({divergencia.sentido === 'acima' ? 'a mais' : 'a menos'} de {brl(Math.abs(divergencia.diferenca))}).
          Confirme antes de entregar — o valor declarado é o que vale.
        </Alerta>
      )}

      {limite.excede && (
        <Alerta tom="danger">
          O total passa do limite do MEI de {brl(LIMITE_MEI_ANUAL)} em {brl(limite.excedente)}.
          {limite.excedeEm20Pct
            ? ' Como o excesso passa de 20%, o desenquadramento retroage ao início do ano.'
            : ' O desenquadramento vale a partir de janeiro do ano seguinte.'}
          {' '}LC 123/2006, art. 18-A.
        </Alerta>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <button type="button" onClick={salvar} disabled={salvando}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar rascunho'}
      </button>
    </div>
  );
}

function Campo({ label, valor, onChange }: { label: string; valor: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number" min={0} step="0.01" value={Number.isFinite(valor) ? valor : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Alerta({ tom, children }: { tom: 'warning' | 'danger'; children: React.ReactNode }) {
  const cls = tom === 'danger'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : 'border-alert/30 bg-alert/5 text-alert';
  return <p className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</p>;
}
