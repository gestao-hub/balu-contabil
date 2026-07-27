'use client';
import { useState, useTransition } from 'react';
import { CreditCard, Receipt, ExternalLink } from 'lucide-react';
import { cancelarAssinaturaAction, assinarPlanoAction } from './actions';

export type CobrancaVm = {
  id: string; status: string; valor_centavos: number;
  vencimento: string; link_fatura: string | null; pix_copia_cola: string | null;
};
export type PlanoVm = { id: string; nome: string; valor_centavos: number };
export type AssinaturaVm = {
  id: string; status: string; trial_termina_em: string | null;
  proxima_cobranca_em: string | null; planoNome: string | null; valor_centavos: number | null;
  /** true quando já existe assinatura no Asaas — some o bloco de contratar. */
  contratada: boolean;
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string) => d.split('-').reverse().join('/');

const ROTULO: Record<string, string> = {
  trial: 'Período de teste',
  ativa: 'Ativa',
  inadimplente: 'Pagamento pendente',
  cancelada: 'Cancelada',
  cortesia: 'Cortesia',
};

/** Cor do estado, nos tokens da marca — nunca cor fixa, senão quebra no
 *  tema claro (o app tem os dois, via next-themes). */
const COR_STATUS: Record<string, string> = {
  trial: 'bg-primary/15 text-primary',
  ativa: 'bg-success/15 text-success',
  inadimplente: 'bg-alert/15 text-alert',
  cancelada: 'bg-surface-3 text-muted-foreground',
  cortesia: 'bg-surface-3 text-muted-foreground-2',
};

export default function AssinaturaView({
  assinatura, cobrancas, planos = [], semAcoes = false,
}: {
  assinatura: AssinaturaVm; cobrancas: CobrancaVm[]; planos?: PlanoVm[];
  /** Some com os blocos de contratar e cancelar. Usado pela tela do
   *  contador, onde os cards de plano (PlanosCards) já fazem as duas
   *  coisas — dois botões de cancelar na mesma tela seria armadilha. */
  semAcoes?: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [planoEscolhido, setPlanoEscolhido] = useState<string>(planos[0]?.id ?? '');
  const [pending, start] = useTransition();

  function cancelar() {
    start(async () => {
      const r = await cancelarAssinaturaAction(assinatura.id);
      setMsg(r.ok ? 'Assinatura cancelada.' : r.error);
      setConfirmando(false);
    });
  }

  function assinar() {
    if (!planoEscolhido) return;
    setMsg(null);
    start(async () => {
      const r = await assinarPlanoAction(assinatura.id, planoEscolhido);
      setMsg(r.ok
        ? 'Assinatura criada. A primeira cobrança aparecerá aqui em instantes.'
        : r.error);
    });
  }

  // O bloco de contratar aparece para quem ainda nao tem assinatura no
  // Asaas e nao e cortesia. E a SAIDA do gate: sem ele, quem sai do trial
  // fica bloqueado sem nada a fazer.
  const podeContratar =
    !semAcoes && !assinatura.contratada && assinatura.status !== 'cortesia' && planos.length > 0;

  return (
    <div className="space-y-4">
      {msg && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground">
          {msg}
        </p>
      )}

      {/* Situação atual */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CreditCard className="size-4 shrink-0 text-primary" />
            {assinatura.planoNome ?? 'Sem plano definido'}
          </h2>
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            COR_STATUS[assinatura.status] ?? 'bg-surface-3 text-muted-foreground'
          }`}>
            {ROTULO[assinatura.status] ?? assinatura.status}
          </span>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {assinatura.valor_centavos !== null && (
            <div className="flex justify-between gap-2 sm:justify-start">
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="text-muted-foreground-2">{reais(assinatura.valor_centavos)} por mês</dd>
            </div>
          )}
          {assinatura.status === 'trial' && assinatura.trial_termina_em && (
            <div className="flex justify-between gap-2 sm:justify-start">
              <dt className="text-muted-foreground">Teste até</dt>
              <dd className="text-muted-foreground-2">{dataBr(assinatura.trial_termina_em)}</dd>
            </div>
          )}
          {assinatura.proxima_cobranca_em && (
            <div className="flex justify-between gap-2 sm:justify-start">
              <dt className="text-muted-foreground">Próxima cobrança</dt>
              <dd className="text-muted-foreground-2">{dataBr(assinatura.proxima_cobranca_em)}</dd>
            </div>
          )}
        </dl>

        {assinatura.status === 'cortesia' && (
          <p className="mt-3 text-xs text-muted-foreground">
            Esta conta está liberada como cortesia, sem cobrança e sem prazo.
          </p>
        )}
      </section>

      {podeContratar && (
        <section className="space-y-3 rounded-md border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-foreground">
            {assinatura.status === 'trial' ? 'Contratar agora' : 'Reativar o acesso'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {assinatura.status === 'trial'
              ? 'Você pode contratar antes do fim do teste — o período de teste continua valendo até o fim.'
              : 'Contrate um plano para voltar a emitir notas e cadastrar clientes.'}
          </p>

          {planos.length === 1 ? (
            <p className="text-sm text-foreground">
              <strong>{planos[0].nome}</strong>
              <span className="text-muted-foreground-2"> — {reais(planos[0].valor_centavos)} por mês</span>
            </p>
          ) : (
            <label className="block text-xs text-muted-foreground">
              Plano
              <select
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
                value={planoEscolhido}
                onChange={(e) => setPlanoEscolhido(e.target.value)}
              >
                {planos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} — {reais(p.valor_centavos)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            disabled={pending || !planoEscolhido}
            onClick={assinar}
          >
            {pending ? 'Processando…' : 'Assinar plano'}
          </button>
          <p className="text-xs text-muted-foreground">
            A fatura permite boleto, Pix ou cartão. Você pode cancelar quando quiser.
          </p>
        </section>
      )}

      {/* Cobranças */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Receipt className="size-4 shrink-0 text-primary" />
          Cobranças
        </h2>
        {cobrancas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma cobrança ainda.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {cobrancas.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-foreground">{reais(c.valor_centavos)}</span>
                  <span className="text-xs text-muted-foreground">
                    vence em {dataBr(c.vencimento)} · {c.status}
                  </span>
                </span>
                {c.link_fatura && (
                  <a
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground-2 hover:text-primary"
                    href={c.link_fatura} target="_blank" rel="noreferrer"
                  >
                    Abrir fatura <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CDC art. 39: cancelar e um clique. Uma confirmacao simples, sem
          tela de retencao, sem "fale com o suporte", sem oferta de desconto
          no caminho. */}
      {!semAcoes && !['cancelada', 'cortesia'].includes(assinatura.status) && (
        <section className="rounded-md border border-border bg-surface p-4">
          {confirmando ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground">Cancelar a assinatura?</span>
              <button
                className="rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                disabled={pending} onClick={cancelar}
              >
                Sim, cancelar
              </button>
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmando(false)}
              >
                Voltar
              </button>
            </div>
          ) : (
            <button
              className="text-sm text-muted-foreground transition-colors hover:text-destructive"
              onClick={() => setConfirmando(true)}
            >
              Cancelar assinatura
            </button>
          )}
        </section>
      )}
    </div>
  );
}
