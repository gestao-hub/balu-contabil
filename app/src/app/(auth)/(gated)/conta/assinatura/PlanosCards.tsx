'use client';
import { useState, useTransition } from 'react';
import { CreditCard, Check, Users, ExternalLink, Loader2 } from 'lucide-react';
import {
  assinarPlanoAction, trocarPlanoAction, cancelarAssinaturaAction,
} from './actions';
import {
  useVerificarPagamento, aguardandoPagamento,
} from './useVerificarPagamento';

export type PlanoCard = {
  id: string;
  nome: string;
  valor_centavos: number;
  clientes_min: number | null;
  clientes_max: number | null;
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanosCards({
  assinaturaId, planos, planoAtivo, planoRecomendado, contratada, clientes, status,
}: {
  assinaturaId: string;
  planos: PlanoCard[];
  /** Plano em vigor hoje. null = ainda não contratou. */
  planoAtivo: string | null;
  /** Plano que a faixa de clientes indica. Recebe o selo "Recomendado". */
  planoRecomendado: string | null;
  /** true quando existe assinatura no Asaas — habilita trocar e cancelar. */
  contratada: boolean;
  clientes: number;
  /** Status da assinatura. Separa "contratado" de "pago" no selo do card. */
  status: string;
}) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [fatura, setFatura] = useState<string | null>(null);
  const [confirmandoCancel, setConfirmandoCancel] = useState(false);
  const [pending, start] = useTransition();

  // Enquanto o Asaas não confirma, a tela se atualiza sozinha — o selo do
  // card vira "Plano ativo" sem ninguém recarregar nada.
  const esperando = aguardandoPagamento(status, contratada);
  useVerificarPagamento(assinaturaId, esperando);

  function agir(
    fn: () => Promise<{ ok: true; faturaUrl?: string | null } | { ok: false; error: string }>,
    sucesso: string,
  ) {
    setMsg(null);
    setFatura(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tipo: 'ok', texto: sucesso } : { tipo: 'erro', texto: r.error });
      // Contratar devolve a fatura já emitida — o escritório precisa dela
      // tanto quanto o empresário, senão termina o fluxo sem onde pagar.
      if (r.ok && r.faturaUrl) setFatura(r.faturaUrl);
      setConfirmandoCancel(false);
    });
  }

  return (
    <section className="space-y-4">
      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          msg.tipo === 'ok'
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-alert/40 bg-alert/10 text-alert'
        }`}>
          <p>{msg.texto}</p>
          {fatura && (
            <a
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
              href={fatura} target="_blank" rel="noreferrer"
            >
              Pagar agora <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {planos.map((p) => {
          const ehAtivo = planoAtivo === p.id && contratada;
          const ehRecomendado = planoRecomendado === p.id;
          // Só vira "trocar" quando JÁ existe assinatura e este card não é o
          // plano em vigor — nos demais casos a ação continua sendo assinar.
          const ehTroca = contratada && !ehAtivo;

          return (
            <article
              key={p.id}
              className={`flex flex-col gap-3 rounded-md border bg-surface p-4 transition-colors ${
                ehAtivo ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'
              }`}
            >
              <header className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`flex items-center gap-2 text-sm leading-tight ${
                    ehAtivo ? 'font-semibold text-primary' : 'text-foreground'
                  }`}>
                    <CreditCard className="size-4 shrink-0 text-primary" />
                    {p.nome}
                  </h3>
                  {ehAtivo && esperando ? (
                    // Contratado mas ainda não pago. "Plano ativo" aqui
                    // afirmaria um pagamento que não aconteceu.
                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted-foreground-2">
                      <Loader2 className="size-3 animate-spin" /> Aguardando pagamento
                    </span>
                  ) : ehAtivo ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                      <Check className="size-3" /> Plano ativo
                    </span>
                  ) : ehRecomendado ? (
                    <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground-2">
                      Recomendado
                    </span>
                  ) : null}
                </div>

                <p className="text-2xl font-semibold text-foreground">{reais(p.valor_centavos)}</p>
                <p className="text-xs text-muted-foreground">por mês</p>

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground-2">
                  <Users className="size-3.5 shrink-0" />
                  {p.clientes_min ?? 0} a {p.clientes_max ?? '∞'} clientes
                </p>
                {ehRecomendado && (
                  <p className="text-xs text-muted-foreground">
                    Faixa da sua carteira hoje ({clientes} cliente{clientes === 1 ? '' : 's'}).
                  </p>
                )}
              </header>

              <div className="mt-auto flex flex-col gap-2 pt-1">
                {/* Botão 1 — assinar / trocar. O rótulo vira "Trocar plano"
                    ao passar o mouse quando já existe um plano em vigor. */}
                <button
                  type="button"
                  disabled={pending || ehAtivo}
                  onClick={() => agir(
                    () => (ehTroca
                      ? trocarPlanoAction(assinaturaId, p.id)
                      : assinarPlanoAction(assinaturaId, p.id)),
                    ehTroca
                      ? 'Plano trocado.'
                      // NAO dizer "plano assinado": contratar nao libera
                      // nada, quem libera e o pagamento reconhecido.
                      : 'Plano contratado. O acesso é liberado assim que o pagamento for confirmado.',
                  )}
                  className={`group flex w-full items-center justify-center rounded-md border px-2 py-2 text-sm transition-colors disabled:opacity-50 ${
                    ehAtivo
                      ? 'cursor-default border-primary/30 text-primary'
                      : 'border-border text-muted-foreground-2 hover:border-primary hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {ehAtivo ? (
                    'Plano atual'
                  ) : ehTroca ? (
                    <>
                      <span className="group-hover:hidden">Assinar plano</span>
                      <span className="hidden group-hover:inline">Trocar plano</span>
                    </>
                  ) : (
                    'Assinar plano'
                  )}
                </button>

                {/* Botão 2 — cancelar. Só age no plano em vigor: cancelar um
                    plano que não é o seu não significa nada. */}
                {ehAtivo && confirmandoCancel ? (
                  <div className="flex gap-2">
                    <button
                      type="button" disabled={pending}
                      onClick={() => agir(
                        () => cancelarAssinaturaAction(assinaturaId), 'Assinatura cancelada.')}
                      className="flex-1 rounded-md border border-destructive px-2 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmandoCancel(false)}
                      className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      Voltar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={pending || !ehAtivo}
                    onClick={() => setConfirmandoCancel(true)}
                    className={`w-full rounded-md border px-2 py-2 text-sm transition-colors disabled:opacity-40 ${
                      ehAtivo
                        ? 'border-border text-muted-foreground-2 hover:border-destructive hover:text-destructive'
                        : 'cursor-default border-border/50 text-muted-foreground'
                    }`}
                  >
                    Cancelar plano
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        O plano recomendado acompanha o tamanho da sua carteira. Você pode assinar um plano maior,
        mas se a carteira crescer além da faixa contratada nós ajustamos para a faixa correta na
        virada do mês. Cancelar é um clique, sem fidelidade.
      </p>
    </section>
  );
}
