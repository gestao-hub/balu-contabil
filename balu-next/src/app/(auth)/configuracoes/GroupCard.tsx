'use client';
// @custom — Focus 3 — Card de grupo do Diagnóstico.
// Cliente porque precisa de useState pro collapse dos grupos com 2+ itens.
// Grupos com 1 item renderizam flat (não há nada pra expandir).
import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, AlertTriangle, XCircle, ChevronDown,
  Upload, RefreshCw, MapPin,
} from 'lucide-react';
import type { CheckGroup, CheckResult, CheckStatus } from '@/lib/fiscal/saude-empresa';
import SyncFocusButton from './SyncFocusButton';

function statusIcon(status: CheckStatus) {
  if (status === 'ok') return { Icon: CheckCircle2, cls: 'text-success' };
  if (status === 'erro') return { Icon: XCircle, cls: 'text-destructive' };
  return { Icon: AlertTriangle, cls: 'text-alert' };
}

export default function GroupCard({ group }: { group: CheckGroup }) {
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

  // Grupo com 2+ itens: parent collapsible.
  return <GroupCollapsible group={group} Icon={Icon} cls={cls} />;
}

function GroupCollapsible({
  group, Icon, cls,
}: { group: CheckGroup; Icon: typeof CheckCircle2; cls: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 overflow-hidden">
      {/* Header clicável (flex split: botão expande, action fica fora pra não disparar toggle) */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`group-${group.key}-content`}
          className="flex-1 flex items-center gap-3 p-4 text-left hover:bg-zinc-50/50 transition"
        >
          <Icon className={`size-5 ${cls} shrink-0`} />
          <p className="text-sm font-medium text-zinc-800 flex-1">{group.label}</p>
          <ChevronDown
            className={`size-4 text-zinc-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {group.action && group.status !== 'ok' && (
          <div className="flex items-center pr-4 pl-2">
            <CheckAction action={group.action} status={group.status} />
          </div>
        )}
      </div>

      {open && (
        <div id={`group-${group.key}-content`} className="border-t border-zinc-100">
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
