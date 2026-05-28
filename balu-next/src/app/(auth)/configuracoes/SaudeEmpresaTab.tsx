// @custom — Focus 3: aba "Saúde da empresa". Server Component que renderiza
// 5 checks (cidade NFS-e, cert presente, cert válido, SERPRO, cadastro Focus)
// com status + ação contextual. Botão de retry da Focus é client island.
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, XCircle, Upload, RefreshCw, MapPin } from 'lucide-react';
import { buildSaudeChecks, type CheckResult, type SaudeState } from '@/lib/fiscal/saude-empresa';
import RetryFocusButton from './RetryFocusButton';

type Props = { state: SaudeState };

export default function SaudeEmpresaTab({ state }: Props) {
  const checks = buildSaudeChecks(state);
  const summary = summarize(checks);

  return (
    <div className="space-y-6 max-w-3xl">
      <SummaryBanner summary={summary} />
      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.key}>
            <CheckRow check={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarize(checks: CheckResult[]) {
  const ok = checks.filter((c) => c.status === 'ok').length;
  const erro = checks.filter((c) => c.status === 'erro').length;
  const pendente = checks.filter((c) => c.status === 'pendente').length;
  const allOk = ok === checks.length;
  return { ok, erro, pendente, total: checks.length, allOk };
}

function SummaryBanner({ summary }: { summary: ReturnType<typeof summarize> }) {
  if (summary.allOk) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 p-4">
        <CheckCircle2 className="size-5 text-success" />
        <div>
          <p className="text-sm font-semibold text-success">Empresa 100% funcional</p>
          <p className="text-xs text-zinc-600">Todos os {summary.total} checks estão verdes.</p>
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

function CheckRow({ check }: { check: CheckResult }) {
  const iconClass = check.status === 'ok'
    ? 'text-success'
    : check.status === 'erro'
    ? 'text-destructive'
    : 'text-alert';
  const Icon = check.status === 'ok' ? CheckCircle2 : check.status === 'erro' ? XCircle : AlertTriangle;
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 p-4">
      <div className="flex items-start gap-3">
        <Icon className={`size-5 mt-0.5 ${iconClass}`} />
        <div>
          <p className="text-sm font-medium text-zinc-800">{check.label}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{check.hint}</p>
        </div>
      </div>
      <CheckAction action={check.action} status={check.status} />
    </div>
  );
}

function CheckAction({ action, status }: { action: CheckResult['action']; status: CheckResult['status'] }) {
  if (!action || status === 'ok') return null;

  if (action === 'upload_cert') {
    return (
      <Link
        href="/configuracoes?tab=fiscal"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <Upload className="size-3.5" />
        Enviar certificado
      </Link>
    );
  }
  if (action === 'editar_endereco') {
    return (
      <Link
        href="/configuracoes?tab=dados"
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <MapPin className="size-3.5" />
        Editar endereço
      </Link>
    );
  }
  if (action === 'sync_focus') {
    return <RetryFocusButton />;
  }
  if (action === 'reauth_serpro') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
        <RefreshCw className="size-3.5" />
        Renovação automática
      </span>
    );
  }
  return null;
}
