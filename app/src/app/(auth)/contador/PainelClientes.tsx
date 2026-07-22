'use client';
// src/app/(auth)/contador/PainelClientes.tsx
// Painel do contador: resumo do escritório + carteira de clientes com semáforo fiscal.
// Segue o idioma visual de DashboardCard (cards) e HonorarioList (tabela + filtros).

import { Fragment, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users, AlertTriangle, HandCoins, Wallet, Plus, MoreVertical, ChevronDown, Mail,
} from 'lucide-react';
import DashboardCard from '@/components/DashboardCard';
import PopupConfirm from '@/components/PopupConfirm';
import { useToast } from '@/components/Toaster';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';
import { formatCnpj } from '@/lib/format/masks';
import type { Semaforo } from '@/lib/fiscal/semaforo';
import type { ContabilidadeCtx } from '@/lib/contador/guards';
import { removerClienteDaCarteiraAction } from './actions';

export type ResumoEscritorio = {
  total_clientes: number;
  honorarios_aberto: string | number;
  honorarios_atrasado: string | number;
};

export type ClienteComSemaforo = {
  company_id: string;
  nome: string | null;
  razao_social: string | null;
  cnpj: string | null;
  regime_code: string | null;
  convite_pendente: boolean;
  faturamento_12m: string | number;
  honorarios_aberto: string | number;
  honorarios_atrasado: string | number;
  semaforo: Semaforo;
};

type Props = {
  clientes: ClienteComSemaforo[];
  resumo: ResumoEscritorio;
  contabilidade: NonNullable<ContabilidadeCtx['contabilidade']>;
};

const REGIME_LABEL: Record<string, string> = { '1': 'Simples', '2': 'Simples', '3': 'Normal', '4': 'MEI' };

const SITUACAO: Record<Semaforo['cor'], { label: string; dot: string; text: string }> = {
  vermelho: { label: 'Irregular', dot: 'bg-destructive', text: 'text-destructive' },
  amarelo:  { label: 'Atenção',   dot: 'bg-alert',        text: 'text-alert' },
  verde:    { label: 'Regular',   dot: 'bg-success',      text: 'text-success' },
};

function regimeFiltro(regimeCode: string | null): 'mei' | 'simples' | 'normal' | 'nenhum' {
  if (regimeCode === '4') return 'mei';
  if (regimeCode === '1' || regimeCode === '2') return 'simples';
  if (regimeCode === '3') return 'normal';
  return 'nenhum';
}

export default function PainelClientes({ clientes, resumo, contabilidade }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState(clientes);
  const [filtroSituacao, setFiltroSituacao] = useState<'' | Semaforo['cor']>('');
  const [filtroRegime, setFiltroRegime] = useState<'' | 'mei' | 'simples' | 'normal'>('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<ClienteComSemaforo | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { setRows(clientes); }, [clientes]);

  const filtrados = rows.filter((c) => {
    if (filtroSituacao && c.semaforo.cor !== filtroSituacao) return false;
    if (filtroRegime && regimeFiltro(c.regime_code) !== filtroRegime) return false;
    return true;
  });

  const qtdVermelho = rows.filter((c) => c.semaforo.cor === 'vermelho').length;
  const qtdAmarelo = rows.filter((c) => c.semaforo.cor === 'amarelo').length;

  function fecharConfirm() { setConfirmando(null); }

  function confirmarRemocao() {
    if (!confirmando) return;
    start(async () => {
      const res = await removerClienteDaCarteiraAction(confirmando.company_id);
      fecharConfirm();
      if (res.ok) {
        toast('success', 'Cliente removido da carteira.');
        setRows((rs) => rs.filter((r) => r.company_id !== confirmando.company_id));
        router.refresh();
      } else {
        toast('error', res.error);
      }
    });
  }

  return (
    <main className="p-6 max-w-6xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-head font-semibold text-foreground">Painel do escritório</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contabilidade.nome}</p>
        </div>
        <Link
          href="/contador/clientes/novo"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" />
          Cadastrar cliente
        </Link>
      </header>

      {/* ── Cards de resumo ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardCard title="Clientes" Icon={Users} value={String(resumo.total_clientes)} />
        <DashboardCard
          title="Irregulares"
          Icon={AlertTriangle}
          value={String(qtdVermelho)}
          subtitle="Situação vermelha"
          tone={qtdVermelho > 0 ? 'danger' : 'default'}
        />
        <DashboardCard
          title="Atenção"
          Icon={AlertTriangle}
          value={String(qtdAmarelo)}
          subtitle="Situação amarela"
          tone={qtdAmarelo > 0 ? 'warning' : 'default'}
        />
        <DashboardCard
          title="Honorários em aberto"
          Icon={Wallet}
          value={formatBRL(valorToCentavos(resumo.honorarios_aberto))}
        />
        <DashboardCard
          title="Honorários atrasados"
          Icon={HandCoins}
          value={formatBRL(valorToCentavos(resumo.honorarios_atrasado))}
          tone={Number(resumo.honorarios_atrasado) > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* ── Filtros ── */}
      <div className="mt-6 flex flex-wrap gap-3">
        <select
          value={filtroSituacao}
          onChange={(e) => setFiltroSituacao(e.target.value as '' | Semaforo['cor'])}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todas as situações</option>
          <option value="vermelho">🔴 Irregular</option>
          <option value="amarelo">🟡 Atenção</option>
          <option value="verde">🟢 Regular</option>
        </select>

        <select
          value={filtroRegime}
          onChange={(e) => setFiltroRegime(e.target.value as '' | 'mei' | 'simples' | 'normal')}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os regimes</option>
          <option value="mei">MEI</option>
          <option value="simples">Simples</option>
          <option value="normal">Normal</option>
        </select>
      </div>

      {/* ── Tabela ── */}
      {clientes.length === 0 ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Sua carteira ainda está vazia. Cadastre um cliente ou compartilhe o link do escritório
          (Configurações do escritório).
        </div>
      ) : filtrados.length === 0 ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum cliente encontrado para os filtros selecionados.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Regime</th>
                <th className="px-4 py-3 text-left">Situação</th>
                <th className="px-4 py-3 text-right">Faturamento 12m</th>
                <th className="px-4 py-3 text-right">Honorários</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map((c) => {
                const sit = SITUACAO[c.semaforo.cor];
                const isExpandido = expandido === c.company_id;
                const nomeExibicao = c.razao_social || c.nome || '—';
                return (
                  <Fragment key={c.company_id}>
                    <tr className="bg-surface hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/contador/clientes/${c.company_id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {nomeExibicao}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{c.cnpj ? formatCnpj(c.cnpj) : '—'}</span>
                          {c.convite_pendente && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-alert/30 bg-alert/10 px-2 py-0.5 font-medium text-alert">
                              <Mail className="size-3" />
                              Convite pendente
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {REGIME_LABEL[c.regime_code ?? ''] ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpandido((v) => (v === c.company_id ? null : c.company_id))}
                          disabled={c.semaforo.motivos.length === 0}
                          className={`inline-flex items-center gap-2 text-xs font-medium ${sit.text} disabled:cursor-default`}
                        >
                          <span className={`size-2.5 rounded-full ${sit.dot}`} />
                          {sit.label}
                          {c.semaforo.motivos.length > 0 && (
                            <ChevronDown className={`size-3.5 transition-transform ${isExpandido ? 'rotate-180' : ''}`} />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatBRL(valorToCentavos(c.faturamento_12m))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div>{formatBRL(valorToCentavos(c.honorarios_aberto))}</div>
                        {Number(c.honorarios_atrasado) > 0 && (
                          <div className="text-xs text-destructive">
                            {formatBRL(valorToCentavos(c.honorarios_atrasado))} atrasado
                          </div>
                        )}
                      </td>
                      <td className="relative px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label="Mais ações"
                          onClick={() => setMenuAberto((v) => (v === c.company_id ? null : c.company_id))}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                        >
                          <MoreVertical className="size-4" />
                        </button>
                        {menuAberto === c.company_id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(null)} />
                            <div className="absolute right-4 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-surface-2 py-1 text-left shadow-lg">
                              <button
                                type="button"
                                onClick={() => { setMenuAberto(null); setConfirmando(c); }}
                                className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-surface-3"
                              >
                                Remover da carteira
                              </button>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                    {isExpandido && c.semaforo.motivos.length > 0 && (
                      <tr className="bg-surface-2">
                        <td colSpan={6} className="px-4 py-3">
                          <ul className="space-y-1.5">
                            {c.semaforo.motivos.map((m, i) => (
                              <li key={i} className="text-muted-foreground text-xs">
                                {m.texto} ({m.norma})
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PopupConfirm
        open={confirmando !== null}
        title="Remover da carteira"
        description="O escritório deixará de ver os dados deste cliente. Nada é apagado."
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        variant="destructive"
        busy={pending}
        onConfirm={confirmarRemocao}
        onCancel={fecharConfirm}
      />
    </main>
  );
}
