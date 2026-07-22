'use client';
// src/app/(auth)/contador/clientes/[companyId]/VisaoCliente.tsx
// Drill-down somente-leitura do cliente: notas / guias / declarações.
// Zero botões de ação — o contador só enxerga, nunca edita, os dados do cliente.
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';
import { formatCnpj } from '@/lib/format/masks';
import { dataBR, competenciaLabel, statusGuiaBadge } from '@/lib/fiscal/guia';

type Empresa = { id: string; nome: string | null; razao_social: string | null; cnpj: string | null };

type NotaRow = { id: string; tipo_documento: string; data_emissao: string; status: string; valor_total: string | number };
type GuiaRow = { id: string; competencia_referencia: string | null; data_vencimento: string | null; data_pagamento: string | null; status: string | null };
type DeclaracaoRow = { id: string; tipo: string; competencia_referencia: string; data_transmissao: string | null; status: string | null };

type Props = {
  empresa: Empresa;
  tab: string;
  notas: NotaRow[];
  guias: GuiaRow[];
  declaracoes: DeclaracaoRow[];
};

const TABS = [
  { key: 'notas', label: 'Notas' },
  { key: 'guias', label: 'Guias' },
  { key: 'declaracoes', label: 'Declarações' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const TIPO_NOTA_LABEL: Record<string, string> = { NFe: 'NF-e', NFCe: 'NFC-e', NFSe: 'NFS-e' };

const STATUS_NOTA_META: Record<string, { label: string; cls: string }> = {
  ativa: { label: 'Ativa', cls: 'bg-success/10 text-success' },
  pendente: { label: 'Pendente', cls: 'bg-alert/10 text-alert' },
  erro: { label: 'Erro', cls: 'bg-destructive/10 text-destructive' },
  cancelada: { label: 'Cancelada', cls: 'bg-surface-2 text-muted-foreground-2' },
  lancada: { label: 'Lançada', cls: 'bg-primary/10 text-primary' },
};

function badgeDeclaracao(status: string | null): { label: string; cls: string } {
  const s = (status ?? '').toLowerCase();
  if (s === 'transmitida') return { label: 'Transmitida', cls: 'bg-success/10 text-success' };
  if (!s) return { label: '—', cls: 'bg-surface-3 text-muted-foreground' };
  return { label: 'Pendente', cls: 'bg-alert/10 text-alert' };
}

export default function VisaoCliente({ empresa, tab, notas, guias, declaracoes }: Props) {
  const active: TabKey = (TABS.find((t) => t.key === tab)?.key ?? 'notas') as TabKey;
  const nomeExibicao = empresa.razao_social || empresa.nome || '—';

  return (
    <main className="p-6 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-3 text-sm text-primary">
        <Eye className="size-4 shrink-0" />
        <span>
          Você está vendo os dados de <strong>{nomeExibicao}</strong> em modo leitura.
        </span>
      </div>

      <Link href="/contador" className="mb-4 inline-block text-sm text-muted-foreground hover:text-primary hover:underline">
        ← Voltar ao painel
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{nomeExibicao}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {empresa.razao_social && empresa.nome && empresa.razao_social !== empresa.nome ? `${empresa.nome} · ` : ''}
          {empresa.cnpj ? formatCnpj(empresa.cnpj) : '—'}
        </p>
      </header>

      <nav className="border-b border-border mb-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const is = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={`/contador/clientes/${empresa.id}?tab=${t.key}`}
                  className={`inline-block px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    is ? 'border-primary text-primary' : 'border-transparent text-muted-foreground-2 hover:text-foreground'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {active === 'notas' ? (
        <NotasTable notas={notas} />
      ) : active === 'guias' ? (
        <GuiasTable guias={guias} />
      ) : (
        <DeclaracoesTable declaracoes={declaracoes} />
      )}
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function NotasTable({ notas }: { notas: NotaRow[] }) {
  if (notas.length === 0) return <EmptyState>Nenhuma nota ainda.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Tipo</th>
            <th className="px-4 py-3 text-left">Data</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {notas.map((n) => {
            const st = STATUS_NOTA_META[n.status];
            return (
              <tr key={n.id} className="bg-surface">
                <td className="px-4 py-3 text-muted-foreground-2">{TIPO_NOTA_LABEL[n.tipo_documento] ?? n.tipo_documento}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{dataBR(n.data_emissao)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st?.cls ?? 'bg-surface-2 text-muted-foreground-2'}`}>
                    {st?.label ?? n.status ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatBRL(valorToCentavos(n.valor_total))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GuiasTable({ guias }: { guias: GuiaRow[] }) {
  if (guias.length === 0) return <EmptyState>Nenhuma guia ainda.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Competência</th>
            <th className="px-4 py-3 text-left">Vencimento</th>
            <th className="px-4 py-3 text-left">Pago em</th>
            <th className="px-4 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {guias.map((g) => {
            const badge = statusGuiaBadge(g.status);
            return (
              <tr key={g.id} className="bg-surface">
                <td className="px-4 py-3 font-medium text-foreground">{competenciaLabel(g.competencia_referencia)}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{dataBR(g.data_vencimento)}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{dataBR(g.data_pagamento)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeclaracoesTable({ declaracoes }: { declaracoes: DeclaracaoRow[] }) {
  if (declaracoes.length === 0) return <EmptyState>Nenhuma declaração ainda.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Tipo</th>
            <th className="px-4 py-3 text-left">Competência</th>
            <th className="px-4 py-3 text-left">Transmitida em</th>
            <th className="px-4 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {declaracoes.map((d) => {
            const badge = badgeDeclaracao(d.status);
            return (
              <tr key={d.id} className="bg-surface">
                <td className="px-4 py-3 text-muted-foreground-2">{d.tipo}</td>
                <td className="px-4 py-3 font-medium text-foreground">{competenciaLabel(d.competencia_referencia)}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{dataBR(d.data_transmissao)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
