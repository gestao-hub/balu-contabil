'use client';
// @custom — PR 3.1 — Tabela de histórico de guias.
// Client component só pelo lado das ações (GuiaActions usa clipboard/transition).
// Lista vem do server. Vazio → mensagem clean.
import { useMemo } from 'react';
import { Archive } from 'lucide-react';
import { brl, dataBR, competenciaLabel, statusGuiaBadge, isGuiaVencida } from '@/lib/fiscal/guia';
import GuiaActions from './GuiaActions';
import GerarDasSimplesButton from './GerarDasSimplesButton';

export type GuiaRow = {
  id: string;
  competencia: string | null;
  vencimento: string | null;
  pagamento: string | null;
  valor: number | null;
  status: string | null;
  pdfUrl: string | null;
  linhaDigitavel: string | null;
  numero: string | null;
};

export default function HistoricoGuias({ initial, isSimples = false }: { initial: GuiaRow[]; isSimples?: boolean }) {
  // Marca como "vencida" visualmente quando vencimento < hoje E status != paga.
  // Não muta o status do banco; é só pra UX. Vence-de-fato vira write quando o
  // cron de atualização rodar (fora do escopo de PR 3.1).
  const rows = useMemo(() => {
    const now = new Date();
    return initial.map((g) => ({
      ...g,
      statusVisual: isGuiaVencida(g.vencimento, g.status, now) ? 'vencida' : (g.status ?? ''),
    }));
  }, [initial]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <div className="inline-flex items-center justify-center size-10 rounded-full bg-surface-2 mb-2">
          <Archive className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">Sem guias anteriores.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Competência</th>
            <th className="px-4 py-3 font-medium">Vencimento</th>
            <th className="px-4 py-3 font-medium text-right">Valor</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((g) => {
            const badge = statusGuiaBadge(g.statusVisual);
            return (
              <tr key={g.id} className="hover:bg-surface-2">
                <td className="px-4 py-3 font-medium text-foreground">{competenciaLabel(g.competencia)}</td>
                <td className="px-4 py-3 text-muted-foreground-2 tabular-nums">{dataBR(g.vencimento)}</td>
                <td className="px-4 py-3 text-right text-foreground tabular-nums">{brl(g.valor)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {isSimples && g.statusVisual !== 'paga' && g.competencia && (
                      <GerarDasSimplesButton competencia={g.competencia} variant="inline" />
                    )}
                    <GuiaActions guia={g} variant="inline" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
