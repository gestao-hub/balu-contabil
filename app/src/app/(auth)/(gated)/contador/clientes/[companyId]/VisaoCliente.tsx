'use client';
// src/app/(auth)/contador/clientes/[companyId]/VisaoCliente.tsx
// Drill-down do cliente: notas / guias / declarações.
// Os DADOS FISCAIS são somente leitura. Há DUAS ações de escrita, e nenhuma
// delas escreve dado fiscal:
//  1. o registro de declaração anual (DASN/DEFIS), que grava pela action com
//     service role + guarda de carteira + auditoria — a RLS do contador
//     (declaracoes_select_contador) segue SELECT-only. Ver spec do Bloco 3, §6.5;
//  2. Bloco 4B — emitir cobrança avulsa pela subconta do escritório
//     (`CobrarDialog`), que é dinheiro do escritório com o cliente dele e não
//     toca nada do fisco.
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';
import { formatCnpj } from '@/lib/format/masks';
import { dataBR, competenciaLabel, statusGuiaBadge } from '@/lib/fiscal/guia';
import RegistrarComprovanteDialog from '@/app/(auth)/(gated)/impostos/RegistrarComprovanteDialog';
import { registrarDeclaracaoAnualContadorAction } from '@/app/(auth)/(gated)/contador/clientes/actions';
import type { DeclaracaoAnualTipo } from '@/lib/fiscal/declaracoes-anuais/tipos';
import CobrarDialog, { type ServicoOpcao } from './CobrarDialog';
import CertificadoCliente, { type CertInfo } from './CertificadoCliente';
import CredencialFocusCard, { type CredencialFocusInfo } from './CredencialFocusCard';

type Empresa = { id: string; nome: string | null; razao_social: string | null; cnpj: string | null };

type NotaRow = { id: string; tipo_documento: string; data_emissao: string; status: string; valor_total: string | number };
type GuiaRow = { id: string; competencia_referencia: string | null; data_vencimento: string | null; data_pagamento: string | null; status: string | null };
type DeclaracaoRow = {
  id: string;
  tipo: string;
  competencia_referencia: string;
  data_transmissao: string | null;
  status: string | null;
  /** Rascunho salvo pelo cliente (jsonb `dados`). Só existe nas declarações anuais. */
  dados?: Record<string, unknown> | null;
};

/** Bloco 4B — tudo que a emissão de cobrança precisa saber, resolvido no
 *  servidor (catálogo, KYC da subconta e gate de inadimplência). */
type CobrancaProps = {
  servicos: ServicoOpcao[];
  podeCobrar: boolean;
  motivoBloqueio: string | null;
  linkBloqueio: { href: string; rotulo: string } | null;
};

type Props = {
  empresa: Empresa;
  tab: string;
  notas: NotaRow[];
  guias: GuiaRow[];
  declaracoes: DeclaracaoRow[];
  cobranca: CobrancaProps;
  cert: CertInfo;
  /** Bloco 5 — a credencial da Focus do cliente (aba "Focus"). */
  credencialFocus: CredencialFocusInfo;
};

const TABS = [
  { key: 'notas', label: 'Notas' },
  { key: 'guias', label: 'Guias' },
  { key: 'declaracoes', label: 'Declarações' },
  { key: 'certificado', label: 'Certificado' },
  { key: 'focus', label: 'Credencial Focus' },
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

export default function VisaoCliente({ empresa, tab, notas, guias, declaracoes, cobranca, cert, credencialFocus }: Props) {
  const active: TabKey = (TABS.find((t) => t.key === tab)?.key ?? 'notas') as TabKey;
  const nomeExibicao = empresa.razao_social || empresa.nome || '—';

  return (
    <main className="p-6 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-4 py-3 text-sm text-primary">
        <Eye className="size-4 shrink-0" />
        <span>
          Você está vendo os dados fiscais de <strong>{nomeExibicao}</strong> em modo leitura.
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

      {/* Bloco 4B — a emissão fica FORA das abas: ela não é uma visão dos dados
          do cliente, é uma ação sobre dinheiro, e some da vista se ficar dentro
          de "Notas". */}
      <div className="mb-6">
        <CobrarDialog
          companyId={empresa.id}
          servicos={cobranca.servicos}
          podeCobrar={cobranca.podeCobrar}
          motivoBloqueio={cobranca.motivoBloqueio}
          linkBloqueio={cobranca.linkBloqueio}
        />
      </div>

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
      ) : active === 'certificado' ? (
        <CertificadoCliente companyId={empresa.id} cert={cert} />
      ) : active === 'focus' ? (
        <CredencialFocusCard {...credencialFocus} />
      ) : (
        <>
          <DeclaracoesAnuaisCard
            companyId={empresa.id}
            declaracoes={declaracoes}
            anoCalendario={new Date().getFullYear() - 1}
          />
          <div className="mt-6">
            <DeclaracoesTable declaracoes={declaracoes} />
          </div>
        </>
      )}
    </main>
  );
}

/**
 * Declarações anuais do ano-calendário: situação + registro do comprovante.
 * O registro só aparece quando o cliente já salvou o rascunho — a action valida
 * `dados` contra o schema inteiro, e o contador não tem de onde inventar os
 * valores declarados. Sem rascunho, dizemos isso em vez de oferecer um botão
 * que falharia na validação.
 */
function DeclaracoesAnuaisCard({ companyId, declaracoes, anoCalendario }: {
  companyId: string;
  declaracoes: DeclaracaoRow[];
  anoCalendario: number;
}) {
  const doAno = (tipo: string) =>
    declaracoes.find((d) => d.tipo === tipo && d.competencia_referencia === String(anoCalendario)) ?? null;

  const linhas: { tipo: DeclaracaoAnualTipo; label: string; prazo: string }[] = [
    { tipo: 'DASN-SIMEI', label: 'DASN-SIMEI', prazo: `31/05/${anoCalendario + 1}` },
    { tipo: 'DEFIS', label: 'DEFIS', prazo: `31/03/${anoCalendario + 1}` },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Declarações anuais — {anoCalendario}</h3>
      <ul className="mt-3 space-y-3">
        {linhas.map((l) => {
          const d = doAno(l.tipo);
          const entregue = Boolean(d?.data_transmissao);
          const rascunho = (d?.dados ?? null) as Record<string, unknown> | null;
          return (
            <li key={l.tipo} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>{l.label} <span className="text-muted-foreground-2">· prazo {l.prazo}</span></span>
              <div className="flex items-center gap-3">
                {!entregue && (rascunho ? (
                  <RegistrarComprovanteDialog
                    onSubmit={async ({ numeroDeclaracao, dataTransmissao, comprovante }) => {
                      const r = await registrarDeclaracaoAnualContadorAction({
                        companyId, tipo: l.tipo, ano: anoCalendario, dados: rascunho,
                        numeroDeclaracao, dataTransmissao, comprovante,
                      });
                      return r.ok ? { ok: true } : { ok: false, error: r.error };
                    }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground-2">
                    O cliente ainda não salvou o rascunho.
                  </span>
                ))}
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  entregue ? 'bg-success/10 text-success'
                    : d ? 'bg-surface-3 text-muted-foreground'
                    : 'bg-alert/10 text-alert'}`}>
                  {entregue ? 'Entregue' : d ? 'Rascunho' : 'Pendente'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
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
