'use client';
// Bloco 7, Task 12 — conexão da conta e fila de sugestões.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Loader2, Link2Off, Check } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { conectarContaAction, desconectarContaAction, confirmarSugestaoAction } from './actions';

export type SugestaoVM = {
  transacaoId: string;
  guiaId: string;
  motivo: string;
  transacao: { data: string; valor: string; descricao: string | null };
  guia: { competencia: string; vencimento: string | null; valor: string };
};

type Props = {
  conectada: boolean;
  consentidaEm: string | null;
  sugestoes: SugestaoVM[];
  totalConciliadas: number;
};

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export default function ConciliacaoClient({ conectada, consentidaEm, sugestoes, totalConciliadas }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pendente, iniciar] = useTransition();

  function conectar() {
    iniciar(async () => {
      const r = await conectarContaAction();
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Conta conectada. A conferência roda uma vez por dia.');
      router.refresh();
    });
  }

  function desconectar() {
    iniciar(async () => {
      const r = await desconectarContaAction();
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Conta desconectada e lançamentos importados apagados.');
      router.refresh();
    });
  }

  function confirmar(s: SugestaoVM) {
    iniciar(async () => {
      const r = await confirmarSugestaoAction(s.transacaoId, s.guiaId);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Pagamento confirmado e guia baixada.');
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Landmark className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Conta bancária</h2>
        </div>

        {conectada ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Conectada{consentidaEm ? ` desde ${dataBR(consentidaEm)}` : ''}. Conferimos os
              lançamentos uma vez por dia e damos baixa automática só quando o valor e a data
              batem sem margem para dúvida. {totalConciliadas > 0 && `Já baixamos ${totalConciliadas} guia(s) por aqui.`}
            </p>
            <button
              type="button" onClick={desconectar} disabled={pendente}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-destructive disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Link2Off className="size-4" />}
              Desconectar
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Ao desconectar, apagamos os lançamentos que importamos. As guias já baixadas continuam pagas.
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Conecte sua conta para que o Balu identifique sozinho o pagamento do DAS e baixe a
              guia — sem você precisar marcar nada.
            </p>
            <div className="mb-4 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">O que você está autorizando</p>
              Leitura dos <strong>lançamentos de entrada</strong> da conta, apenas para casar com
              suas guias. Não movimentamos dinheiro, não guardamos saldo e você pode revogar a
              qualquer momento — ao revogar, os lançamentos importados são apagados.
            </div>
            <button
              type="button" onClick={conectar} disabled={pendente}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Landmark className="size-4" />}
              Conectar e autorizar
            </button>
          </>
        )}
      </section>

      {conectada && (
        <section>
          <h2 className="mb-1 text-lg font-semibold text-foreground">Precisam da sua confirmação</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Encontramos entradas que podem ser o pagamento de mais de uma guia. Como errar aqui
            faria você achar que pagou o que não pagou, preferimos perguntar.
          </p>

          {sugestoes.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nada pendente de confirmação.
            </div>
          ) : (
            <ul className="space-y-2">
              {sugestoes.map((s) => (
                <li key={`${s.transacaoId}:${s.guiaId}`} className="rounded-md border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <p className="text-foreground">
                        <span className="font-medium">Entrada de {s.transacao.valor}</span> em {dataBR(s.transacao.data)}
                        {s.transacao.descricao ? ` · ${s.transacao.descricao}` : ''}
                      </p>
                      <p className="text-muted-foreground">
                        Pode ser o DAS da competência {s.guia.competencia}
                        {s.guia.vencimento ? `, vencimento ${dataBR(s.guia.vencimento)}` : ''} ({s.guia.valor})
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{s.motivo}</p>
                    </div>
                    <button
                      type="button" onClick={() => confirmar(s)} disabled={pendente}
                      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
                    >
                      {pendente ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      É esta guia
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
