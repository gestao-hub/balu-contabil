// @custom — Focus 3 — aba "Diagnóstico". Server Component que monta os grupos
// (cidade, certificado, SERPRO, cadastro Focus) e delega cada card pro
// `<GroupCard>` (client island; grupos com 2+ itens ficam colapsáveis).
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  buildSaudeGroups,
  type CheckGroup,
  type SaudeState,
} from '@/lib/fiscal/saude-empresa';
import GroupCard from './GroupCard';

type Props = { state: SaudeState };

export default function SaudeEmpresaTab({ state }: Props) {
  const groups = buildSaudeGroups(state);
  const summary = summarize(groups);

  return (
    <div className="space-y-6 max-w-3xl">
      <SummaryBanner summary={summary} />
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.key}>
            <GroupCard group={g} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarize(groups: CheckGroup[]) {
  const ok = groups.filter((g) => g.status === 'ok').length;
  const erro = groups.filter((g) => g.status === 'erro').length;
  const pendente = groups.filter((g) => g.status === 'pendente').length;
  const allOk = ok === groups.length;
  return { ok, erro, pendente, total: groups.length, allOk };
}

function SummaryBanner({ summary }: { summary: ReturnType<typeof summarize> }) {
  if (summary.allOk) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 p-4">
        <CheckCircle2 className="size-5 text-success" />
        <div>
          <p className="text-sm font-semibold text-success">Empresa 100% funcional</p>
          <p className="text-xs text-muted-foreground-2">Todos os {summary.total} itens estão verdes.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-alert/20 bg-alert/5 p-4">
      <AlertTriangle className="size-5 text-alert" />
      <div>
        <p className="text-sm font-semibold text-alert">Há pendências para emitir notas</p>
        <p className="text-xs text-muted-foreground-2">
          {summary.ok}/{summary.total} ok ·{' '}
          {summary.pendente > 0 && `${summary.pendente} pendente(s)`}{' '}
          {summary.erro > 0 && `· ${summary.erro} com erro`}
        </p>
      </div>
    </div>
  );
}
