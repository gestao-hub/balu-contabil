import { competenciaLabel, dataBR } from '@/lib/fiscal/guia';

export type DeclaracaoRow = {
  id: string;
  competencia: string;            // YYYYMM
  tipo: string;                   // 'PGDAS-D'
  numeroDeclaracao: string | null;
  dataTransmissao: string | null; // ISO
  status: string | null;          // 'transmitida' | 'pendente'
};

function badge(status: string | null) {
  return status === 'transmitida'
    ? 'bg-green-500/10 text-green-600'
    : 'bg-amber-500/10 text-amber-600';
}

export default function DeclaracoesSection({ declaracoes }: { declaracoes: DeclaracaoRow[] }) {
  if (declaracoes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
        Nenhuma declaração consultada. Use <strong>“Consultar na SERPRO”</strong> acima para buscar as PGDAS-D do ano.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Competência</th>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            <th className="px-3 py-2 font-medium">Nº declaração</th>
            <th className="px-3 py-2 font-medium">Transmitida em</th>
          </tr>
        </thead>
        <tbody>
          {declaracoes.map((d) => (
            <tr key={d.id} className="border-t border-border">
              <td className="px-3 py-2">{competenciaLabel(d.competencia)}</td>
              <td className="px-3 py-2">{d.tipo}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge(d.status)}`}>
                  {d.status === 'transmitida' ? 'Transmitida' : 'Pendente'}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{d.numeroDeclaracao ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">{d.dataTransmissao ? dataBR(d.dataTransmissao) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
