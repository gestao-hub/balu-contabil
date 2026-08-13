'use client';
import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toaster';
import { MSG_ASSINATURA_PENDENTE, MSG_SUBCONTA_NAO_APROVADA } from '@/lib/billing/mensagens';
import {
  Plus, CheckCircle, XCircle, Pencil, Trash2, ChevronLeft, ChevronRight, Download,
  Receipt, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { marcarPagoV2Action, desmarcarPagoV2Action, deleteHonorarioV2Action } from './actions';
import HonorarioV2FormDialog, { type ClienteOption, type HonorarioV2Row } from './HonorarioV2FormDialog';
import CobrarHonorarioDialog, { type ResultadoCobranca } from './CobrarHonorarioDialog';
import PopupConfirm from '@/components/PopupConfirm';
import { statusHonorario, type StatusHonorario } from '@/lib/fiscal/status-honorario';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { formatBRL, valorToCentavos } from '@/lib/format/dinheiro';

export type { HonorarioV2Row };

const POR_PAGINA = 100;

const STATUS_BADGE: Record<StatusHonorario, string> = {
  pago:     'bg-success/10 text-success border-success/30',
  atrasado: 'bg-destructive/10 text-destructive border-destructive/30',
  aberto:   'bg-alert/10 text-alert border-alert/30',
};
const STATUS_LABEL: Record<StatusHonorario, string> = { pago: 'Pago', atrasado: 'Atrasado', aberto: 'Aberto' };

const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'outro', label: 'Outro' },
] as const;

function mesLabel(d: string) {
  if (!d) return '—';
  const [y, m] = d.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** YYYY-MM-DD → YYYY-MM (comparação com o filtro de competência) */
function mesCurto(d: string): string {
  return d ? d.slice(0, 7) : '';
}

function dataBR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${(day ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`;
}

/** Escapa campo CSV: envolve em aspas se contém `"`, `;`, `,`, quebra de linha. */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v).replace(/[\r\n]+/g, ' ');
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: HonorarioV2Row[]) {
  const header = ['Cliente', 'Competência', 'Valor (R$)', 'Vencimento', 'Pagamento', 'Status', 'Recorrente', 'Observação'];
  const lines = [
    '﻿' + header.map(esc).join(';'),
    ...rows.map(r => [
      r.companies?.nome ?? '',
      mesLabel(r.mes_referencia),
      // Valor com vírgula decimal, sempre entre aspas — evita shift de coluna no Excel.
      `"${Number(r.valor).toFixed(2).replace('.', ',')}"`,
      dataBR(r.data_vencimento),
      dataBR(r.data_pagamento),
      STATUS_LABEL[statusHonorario(r)],
      r.recorrente ? `Sim (dia ${r.recorrencia_dia})` : 'Não',
      r.observacao ?? '',
    ].map((v, i) => i === 2 ? v : esc(v)).join(';')),
  ];
  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `honorarios_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Props = {
  initial: HonorarioV2Row[];
  clientes: ClienteOption[];
  /** Assinatura pendente: as actions de escrita vão barrar. A lista continua
   *  visível — consultar não depende de pagamento —, mas o bloqueio é dito
   *  antes, não depois de preencher o formulário. */
  assinaturaPendente?: boolean;
  /** Bloco 4B — KYC da subconta do escritório aprovado no Asaas. Default
   *  `false` de propósito: quem esquecer de passar não emite cobrança, que é o
   *  lado seguro de errar quando o assunto é dinheiro de terceiro. */
  subcontaAprovada?: boolean;
};

export default function HonorariosV2List({
  initial, clientes, assinaturaPendente = false, subcontaAprovada = false,
}: Props) {
  const toast = useToast();
  const [rows, setRows]                     = useState(initial);
  const [filtroStatus, setFiltroStatus]     = useState<'' | StatusHonorario>('');
  const [filtroCompetencia, setFiltroCompetencia] = useState('');
  const [pagina, setPagina]                 = useState(1);
  const [showForm, setShowForm]             = useState(false);
  const [editing, setEditing]               = useState<HonorarioV2Row | undefined>();
  const [confirmRow, setConfirmRow]         = useState<HonorarioV2Row | null>(null);
  const [confirmAcao, setConfirmAcao]       = useState<'pagar' | 'desmarcar' | 'excluir' | null>(null);
  const [forma, setForma]                   = useState<string>('pix');
  const [pending, start]                    = useTransition();
  // Bloco 4B — emissão de cobrança do honorário.
  const [cobrarRow, setCobrarRow]           = useState<HonorarioV2Row | null>(null);
  // Caixa PERSISTENTE do resultado, e não só toast: o toast some em 3s e aqui
  // há um link de fatura para abrir e, às vezes, um aviso de duplicidade que o
  // contador precisa ler antes de mandar o boleto ao cliente.
  const [emitida, setEmitida]               = useState<ResultadoCobranca | null>(null);

  useEffect(() => { setRows(initial); }, [initial]);

  // Por que a cobrança está indisponível, se estiver. O motivo é dito na
  // ENTRADA — clicar para descobrir que não podia é o que se está evitando.
  const bloqueioCobranca = assinaturaPendente
    ? MSG_ASSINATURA_PENDENTE
    : !subcontaAprovada ? MSG_SUBCONTA_NAO_APROVADA : null;

  const filtrados = rows.filter(r => {
    if (filtroStatus && statusHonorario(r) !== filtroStatus) return false;
    if (filtroCompetencia && mesCurto(r.mes_referencia) !== filtroCompetencia) return false;
    return true;
  });

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual  = Math.min(pagina, totalPaginas);
  const paginados    = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  function fecharConfirm() { setConfirmRow(null); setConfirmAcao(null); }

  function confirmarAcao() {
    if (!confirmRow || !confirmAcao) return;
    if (confirmAcao === 'pagar') {
      start(async () => {
        const res = await marcarPagoV2Action(confirmRow.id, forma);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Honorário marcado como pago.');
          setRows(rs => rs.map(r => r.id === confirmRow.id
            ? { ...r, data_pagamento: ymdBrt(), forma_pagamento: forma }
            : r));
        } else { toast('error', res.error); }
      });
    } else if (confirmAcao === 'desmarcar') {
      start(async () => {
        const res = await desmarcarPagoV2Action(confirmRow.id);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Pagamento desfeito.');
          setRows(rs => rs.map(r => r.id === confirmRow.id ? { ...r, data_pagamento: null, forma_pagamento: null } : r));
        } else { toast('error', res.error); }
      });
    } else {
      start(async () => {
        const res = await deleteHonorarioV2Action(confirmRow.id);
        fecharConfirm();
        if (res.ok) {
          toast('success', 'Honorário excluído.');
          setRows(rs => rs.filter(r => r.id !== confirmRow.id));
        } else { toast('error', res.error); }
      });
    }
  }

  return (
    <div className="space-y-6">

      {/* Um aviso só, no topo, em vez de cada botão falhar por conta própria:
          criar, editar, marcar pago e desmarcar estão todos barrados. */}
      {assinaturaPendente && (
        <div className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          {MSG_ASSINATURA_PENDENTE}{' '}
          <Link href="/contador/assinatura" className="font-medium underline">Ver assinatura</Link>
        </div>
      )}

      {/* Bloco 4B — o outro motivo de "Gerar cobrança" não funcionar. Só aparece
          quando a assinatura está em dia: dois avisos de bloqueio juntos não
          dizem qual resolver primeiro. */}
      {!assinaturaPendente && !subcontaAprovada && (
        <div className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          {MSG_SUBCONTA_NAO_APROVADA}{' '}
          <Link href="/contador/configuracoes/subconta" className="font-medium underline">
            Configurar conta de recebimento
          </Link>
        </div>
      )}

      {emitida && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Cobrança emitida. O cliente já a vê no app dele.
            {emitida.linkFatura && (
              <>
                {' '}
                <a href={emitida.linkFatura} target="_blank" rel="noopener noreferrer"
                  className="font-medium underline">
                  Abrir a fatura
                </a>
              </>
            )}
          </span>
        </div>
      )}

      {/* O aviso da action (back-pointer não gravado, segunda cobrança) fica
          SEPARADO do sucesso e com cara de alerta: ele manda conferir no Asaas
          antes de enviar o boleto, e não pode se perder dentro da frase verde. */}
      {emitida?.aviso && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{emitida.aviso}</span>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filtroStatus}
          onChange={e => { setFiltroStatus(e.target.value as StatusHonorario | ''); setPagina(1); }}
          className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="aberto">Aberto</option>
          <option value="atrasado">Atrasado</option>
          <option value="pago">Pago</option>
        </select>

        <label className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
          Competência
          <input
            type="month"
            value={filtroCompetencia}
            onChange={e => { setFiltroCompetencia(e.target.value); setPagina(1); }}
            className="rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          />
        </label>
        {filtroCompetencia && (
          <button type="button" onClick={() => { setFiltroCompetencia(''); setPagina(1); }}
            className="text-xs text-muted-foreground hover:text-foreground">
            ✕
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => downloadCSV(filtrados)}
            disabled={filtrados.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-40"
          >
            <Download className="size-4" />
            Exportar CSV
          </button>
          <button
            onClick={() => {
              // Diz na hora, em vez de deixar preencher o formulário inteiro
              // para a action recusar no envio.
              if (assinaturaPendente) { toast('error', MSG_ASSINATURA_PENDENTE); return; }
              setEditing(undefined); setShowForm(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" />
            Novo honorário
          </button>
        </div>
      </div>

      {/* ── Tabela ── */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum honorário encontrado.
        </div>
      ) : (
        <>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtrados.length)} de {filtrados.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
                <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Competência</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-left">Vencimento</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Recorrente</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginados.map(r => {
                  const st = statusHonorario(r);
                  return (
                    <tr key={r.id} className="bg-surface hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{r.companies?.nome || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground capitalize">{mesLabel(r.mes_referencia)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(valorToCentavos(r.valor))}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dataBR(r.data_vencimento)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[st]}`}>
                          {STATUS_LABEL[st]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.recorrente ? `✓ dia ${r.recorrencia_dia}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {/* Bloco 4B — "Gerar cobrança". Some no honorário já
                              PAGO: a action recusa esse caso, e oferecer o botão
                              seria convidar a um erro. Não há pré-checagem de
                              "já cobrado" aqui de propósito — quem responde isso
                              é `cobrancas_escritorio` (a ligação canônica, que
                              sabe o STATUS e libera recobrança após estorno), e
                              a action já devolve o link da cobrança que bloqueou. */}
                          {st !== 'pago' && (
                            <button
                              onClick={() => {
                                if (bloqueioCobranca) { toast('error', bloqueioCobranca); return; }
                                setEmitida(null);
                                setCobrarRow(r);
                              }}
                              disabled={pending}
                              title={bloqueioCobranca ?? 'Gerar cobrança pela conta do escritório'}
                              className="text-primary hover:opacity-70 disabled:opacity-40"
                            >
                              <Receipt className="size-4" />
                            </button>
                          )}
                          {st !== 'pago' ? (
                            <button onClick={() => { setConfirmRow(r); setConfirmAcao('pagar'); setForma('pix'); }} disabled={pending}
                              title="Marcar como pago" className="text-success hover:opacity-70 disabled:opacity-40">
                              <CheckCircle className="size-4" />
                            </button>
                          ) : (
                            <button onClick={() => { setConfirmRow(r); setConfirmAcao('desmarcar'); }} disabled={pending}
                              title="Desmarcar pagamento" className="text-alert hover:opacity-70 disabled:opacity-40">
                              <XCircle className="size-4" />
                            </button>
                          )}
                          <button onClick={() => { setEditing(r); setShowForm(true); }}
                            title="Editar" className="text-muted-foreground hover:text-foreground">
                            <Pencil className="size-4" />
                          </button>
                          <button onClick={() => { setConfirmRow(r); setConfirmAcao('excluir'); }} disabled={pending}
                            title="Excluir" className="text-destructive hover:opacity-70 disabled:opacity-40">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtrados.length)} de {filtrados.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
                <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                  className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <CobrarHonorarioDialog
        honorario={cobrarRow}
        onFechar={() => setCobrarRow(null)}
        onEmitida={(r) => { setEmitida(r); toast('success', 'Cobrança emitida.'); }}
      />

      <HonorarioV2FormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(undefined); }}
        clientes={clientes}
        editing={editing}
      />

      <PopupConfirm
        open={confirmAcao === 'pagar'}
        title="Confirmar pagamento"
        description={`Marcar honorário de ${confirmRow ? formatBRL(valorToCentavos(confirmRow.valor)) : ''} como pago?`}
        confirmLabel="Marcar como pago"
        cancelLabel="Cancelar"
        variant="primary"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      >
        <label className="block text-sm text-muted-foreground-2">
          Forma de pagamento
          <select
            value={forma}
            onChange={e => setForma(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
          >
            {FORMAS_PAGAMENTO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </PopupConfirm>

      <PopupConfirm
        open={confirmAcao === 'desmarcar'}
        title="Desmarcar pagamento"
        description="Este honorário volta para pendente/aberto."
        confirmLabel="Desmarcar"
        cancelLabel="Cancelar"
        variant="primary"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      />

      <PopupConfirm
        open={confirmAcao === 'excluir'}
        title="Excluir honorário"
        description={`Tem certeza que deseja excluir o honorário de ${confirmRow ? formatBRL(valorToCentavos(confirmRow.valor)) : ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        busy={pending}
        onConfirm={confirmarAcao}
        onCancel={fecharConfirm}
      />
    </div>
  );
}
