// @custom — Focus 3: aba "Diagnóstico". Server Component que renderiza 4 grupos
// (cidade NFS-e, Certificado A1, SERPRO, Cadastro na Focus) com roll-up de status.
// Grupos com 2+ itens (Cert, Focus) mostram parent + sub-itens; grupos com 1
// item renderizam flat. Botão de retry da Focus é client island.
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, XCircle, Upload, RefreshCw, MapPin } from 'lucide-react';
import {
  buildSaudeGroups,
  type CheckGroup,
  type CheckResult,
  type CheckStatus,
  type SaudeState,
} from '@/lib/fiscal/saude-empresa';
import SyncFocusButton from './SyncFocusButton';

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
          <p className="text-xs text-zinc-600">Todos os {summary.total} itens estão verdes.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-alert/20 bg-alert/5 p-4">
      <AlertTriangle className="size-5 text-alert" />
      <div>
        <p className="text-sm font-semibold text-alert">Há pendências para emitir notas</p>
        <p className="text-xs text-zinc-600">
          {summary.ok}/{summary.total} ok ·{' '}
          {summary.pendente > 0 && `${summary.pendente} pendente(s)`}{' '}
          {summary.erro > 0 && `· ${summary.erro} com erro`}
        </p>
      </div>
    </div>
  );
}

function statusIcon(status: CheckStatus) {
  if (status === 'ok') return { Icon: CheckCircle2, cls: 'text-success' };
  if (status === 'erro') return { Icon: XCircle, cls: 'text-destructive' };
  return { Icon: AlertTriangle, cls: 'text-alert' };
}

function GroupCard({ group }: { group: CheckGroup }) {
  const { Icon, cls } = statusIcon(group.status);

  // Grupo de 1 item: renderiza flat com o hint do item (UX original).
  if (group.items.length === 1) {
    const item = group.items[0]!;
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 p-4">
        <div className="flex items-start gap-3">
          <Icon className={`size-5 mt-0.5 ${cls}`} />
          <div>
            <p className="text-sm font-medium text-zinc-800">{group.label}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{item.hint}</p>
          </div>
        </div>
        <CheckAction action={group.action} status={group.status} />
      </div>
    );
  }

  // Grupo com 2+ itens: parent card + sub-itens.
  return (
    <div className="rounded-lg border border-zinc-200">
      <div className="flex items-start justify-between gap-4 p-4 border-b border-zinc-100">
        <div className="flex items-start gap-3">
          <Icon className={`size-5 mt-0.5 ${cls}`} />
          <p className="text-sm font-medium text-zinc-800">{group.label}</p>
        </div>
        <CheckAction action={group.action} status={group.status} />
      </div>
      <ul className="divide-y divide-zinc-100">
        {group.items.map((item, idx) => (
          <li key={idx}>
            <SubItem item={item} />
          </li>
        ))}
      </ul>
      {group.meta && (
        <p className="px-4 py-2 text-xs text-zinc-500 border-t border-zinc-100 bg-zinc-50/50">
          {group.meta}
        </p>
      )}
    </div>
  );
}

function SubItem({ item }: { item: CheckResult }) {
  const { Icon, cls } = statusIcon(item.status);
  return (
    <div className="flex items-start gap-3 px-4 py-3 pl-12">
      <Icon className={`size-4 mt-0.5 ${cls}`} />
      <div className="min-w-0">
        <p className="text-sm text-zinc-700">{item.label}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{item.hint}</p>
      </div>
    </div>
  );
}

function CheckAction({
  action, status,
}: { action: CheckGroup['action']; status: CheckStatus }) {
  if (!action || status === 'ok') return null;

  const baseCls =
    'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 shrink-0 whitespace-nowrap';

  if (action === 'upload_cert') {
    return (
      <Link href="/configuracoes?tab=fiscal" className={baseCls}>
        <Upload className="size-3.5" />
        Enviar certificado
      </Link>
    );
  }
  if (action === 'editar_endereco') {
    return (
      <Link href="/configuracoes?tab=dados" className={baseCls}>
        <MapPin className="size-3.5" />
        Editar endereço
      </Link>
    );
  }
  if (action === 'sync_focus') {
    return <SyncFocusButton />;
  }
  if (action === 'reauth_serpro') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500 shrink-0 whitespace-nowrap">
        <RefreshCw className="size-3.5" />
        Renovação automática
      </span>
    );
  }
  return null;
}
