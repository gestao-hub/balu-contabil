// @custom — Seção Apuração (estimativa) do detalhe da competência. Migra a dl do CompetenciaAtualCard.
import { brl } from '@/lib/fiscal/guia';
import { fatorRAplicavel } from '@/lib/fiscal/regime';
import type { ApuracaoRow } from './page';

export default function SecaoApuracao({ apuracao }: { apuracao: ApuracaoRow | null }) {
  if (!apuracao) {
    return <p className="text-sm text-muted-foreground">Sem apuração calculada para esta competência.</p>;
  }
  const payload = (apuracao.payload_calculo ?? null) as
    | { segregado?: boolean; porAnexo?: Array<{ anexo: string; receita: number; aliquotaEfetiva: number; valor: number }> }
    | null;
  const porAnexo = payload?.segregado && Array.isArray(payload.porAnexo) ? payload.porAnexo : null;

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {apuracao.anexo_simples && (
          <Linha label="Anexo">{apuracao.anexo_simples}{fatorRAplicavel(apuracao.anexo_simples) ? ' · Fator R' : ''}</Linha>
        )}
        {apuracao.receita_mes != null && <Linha label="Receita do mês">{brl(apuracao.receita_mes)}</Linha>}
        {apuracao.rbt12 != null && <Linha label="RBT12">{brl(apuracao.rbt12)}</Linha>}
        {apuracao.aliquota_efetiva != null && <Linha label="Alíquota efetiva">{(apuracao.aliquota_efetiva * 100).toFixed(2)}%</Linha>}
        {apuracao.valor_imposto != null && <Linha label="Estimativa">{brl(apuracao.valor_imposto)}</Linha>}
      </dl>
      {porAnexo && (
        <div className="mt-4 rounded-md border border-border divide-y divide-border text-sm">
          {porAnexo.map((p) => (
            <div key={p.anexo} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground-2">{p.anexo}</span>
              <span className="tabular-nums">{brl(p.receita)} · {(p.aliquotaEfetiva * 100).toFixed(2)}% · <strong className="text-foreground">{brl(p.valor)}</strong></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
