'use client';
// @custom — PR 3.1 — Tabela de histórico de guias.
// Client component só pelo lado das ações (GuiaActions usa clipboard/transition).
// Lista vem do server. Vazio → mensagem clean.
import { useMemo, useState, Fragment } from 'react';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { brl, dataBR, competenciaLabel, statusGuiaBadge, isGuiaVencida } from '@/lib/fiscal/guia';
import GuiaActions from './GuiaActions';
import ComprovanteGuia from './ComprovanteGuia';

export type GuiaRow = {
  id: string;
  competencia: string | null;
  vencimento: string | null;
  pagamento: string | null;
  valor: number | null;
  principal: number | null;
  multa: number | null;
  juros: number | null;
  status: string | null;
  pdfUrl: string | null;
  linhaDigitavel: string | null;
  numero: string | null;
  /** Nome do comprovante de pagamento anexado (0084), ou null. O path e a URL
   *  nunca chegam ao cliente — a URL assinada é pedida por clique. */
  comprovanteNome: string | null;
};

export default function HistoricoGuias({ initial }: { initial: GuiaRow[] }) {
  // Linha expansível: revela o detalhamento que o PAGAMENTOS71 traz (principal/multa/juros/pagamento).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  // Marca como "vencida" visualmente quando vencimento < hoje E status != paga.
  // Continua sem mutar o banco — e continua existindo mesmo depois de o write
  // ter entrado (`marcar_guias_vencidas`, migration 0078, chamada pelo cron
  // diário). Não é redundância: o cron roda uma vez por dia, então entre a
  // meia-noite e a passada dele há uma janela em que a guia venceu e o banco
  // ainda não sabe. Nessa janela é isto aqui que mostra a verdade.
  //
  // A regra visual é a mais larga das duas de propósito: qualquer não-paga
  // vencida aparece como vencida, enquanto o banco só grava sobre 'gerada'
  // (ver o cabeçalho da 0078). Uma guia em 'erro' e vencida aparece vencida na
  // tela sem que o estado de erro seja apagado no banco.
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
            const isOpen = expandedId === g.id;
            // TODA linha expande, desde o comprovante (0084). Antes só expandia
            // quando o SERPRO tinha devolvido detalhamento — e uma guia lançada
            // à mão, que não tem principal/multa/juros, ficaria sem lugar nenhum
            // para anexar a prova de pagamento. Justamente quem lança à mão é
            // quem mais precisa guardar o recibo do banco.
            const temDetalheSerpro =
              g.principal != null || g.multa != null || g.juros != null || !!g.pagamento || !!g.numero;
            return (
              <Fragment key={g.id}>
                <tr className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <button
                      type="button"
                      onClick={() => toggle(g.id)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1.5 hover:text-primary"
                    >
                      {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      {competenciaLabel(g.competencia)}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground-2 tabular-nums">{dataBR(g.vencimento)}</td>
                  <td className="px-4 py-3 text-right text-foreground tabular-nums">{brl(g.valor)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <GuiaActions guia={g} variant="inline" />
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-surface-2/50">
                    <td colSpan={5} className="px-4 py-3">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-5">
                        <div>
                          <dt className="text-muted-foreground">Documento</dt>
                          <dd className="font-mono text-foreground">{g.numero ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Principal</dt>
                          <dd className="tabular-nums text-foreground">{brl(g.principal)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Multa</dt>
                          <dd className="tabular-nums text-foreground">{brl(g.multa)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Juros</dt>
                          <dd className="tabular-nums text-foreground">{brl(g.juros)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Pago em</dt>
                          <dd className="tabular-nums text-foreground">{dataBR(g.pagamento)}</dd>
                        </div>
                      </dl>

                      <div className="mt-3 border-t border-border pt-3">
                        <p className="mb-2 text-xs text-muted-foreground">
                          Comprovante de pagamento
                          {!temDetalheSerpro && ' — guarde aqui o recibo do banco.'}
                        </p>
                        <ComprovanteGuia guiaId={g.id} nomeAtual={g.comprovanteNome} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
