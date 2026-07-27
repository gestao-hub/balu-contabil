'use client';
import { useState, useTransition } from 'react';
import {
  assinarPlanoAction, trocarPlanoAction, cancelarAssinaturaAction,
} from '../../conta/assinatura/actions';

export type PlanoCard = {
  id: string;
  nome: string;
  valor_centavos: number;
  clientes_min: number | null;
  clientes_max: number | null;
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanosCards({
  assinaturaId, planos, planoAtivo, planoRecomendado, contratada, clientes,
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
}) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [confirmandoCancel, setConfirmandoCancel] = useState(false);
  const [pending, start] = useTransition();

  function agir(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, sucesso: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tipo: 'ok', texto: sucesso } : { tipo: 'erro', texto: r.error });
      setConfirmandoCancel(false);
    });
  }

  return (
    <section className="space-y-4">
      {msg && (
        <p className={`text-sm rounded border px-3 py-2 ${
          msg.tipo === 'ok'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}>
          {msg.texto}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {planos.map((p) => {
          const ehAtivo = planoAtivo === p.id && contratada;
          const ehRecomendado = planoRecomendado === p.id;
          // Só vira "trocar" quando JÁ existe assinatura e este card não é o
          // plano em vigor — nos demais casos a ação continua sendo assinar.
          const ehTroca = contratada && !ehAtivo;

          return (
            <article
              key={p.id}
              className={`rounded-lg border p-4 flex flex-col gap-3 ${
                ehAtivo ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-neutral-300'
              }`}
            >
              <header className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-tight">{p.nome}</h3>
                  {ehAtivo && (
                    <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      Seu plano
                    </span>
                  )}
                  {!ehAtivo && ehRecomendado && (
                    <span className="shrink-0 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                      Recomendado
                    </span>
                  )}
                </div>
                <p className="text-2xl font-semibold">{reais(p.valor_centavos)}</p>
                <p className="text-xs text-neutral-500">por mês</p>
                <p className="text-sm text-neutral-600">
                  {p.clientes_min ?? 0} a {p.clientes_max ?? '∞'} clientes
                </p>
                {ehRecomendado && (
                  <p className="text-xs text-sky-700">
                    Faixa da sua carteira hoje ({clientes} cliente{clientes === 1 ? '' : 's'}).
                  </p>
                )}
              </header>

              <div className="mt-auto flex flex-col gap-2">
                {/* Botão 1 — assinar / trocar. O rótulo vira "Trocar plano"
                    ao passar o mouse quando já existe um plano em vigor. */}
                <button
                  type="button"
                  disabled={pending || ehAtivo}
                  onClick={() => agir(
                    () => (ehTroca
                      ? trocarPlanoAction(assinaturaId, p.id)
                      : assinarPlanoAction(assinaturaId, p.id)),
                    ehTroca ? 'Plano trocado.' : 'Plano assinado.',
                  )}
                  className={`group w-full rounded border px-3 py-1.5 text-sm ${
                    ehAtivo
                      ? 'cursor-default border-neutral-200 text-neutral-400'
                      : 'border-neutral-800 hover:bg-neutral-900 hover:text-white'
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
                      className="flex-1 rounded border border-neutral-800 px-3 py-1.5 text-sm"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmandoCancel(false)}
                      className="rounded px-3 py-1.5 text-sm underline"
                    >
                      Voltar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={pending || !ehAtivo}
                    onClick={() => setConfirmandoCancel(true)}
                    className={`w-full rounded border px-3 py-1.5 text-sm ${
                      ehAtivo
                        ? 'border-neutral-300 hover:bg-neutral-100'
                        : 'cursor-default border-neutral-200 text-neutral-400'
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

      <p className="text-xs text-neutral-500">
        O plano recomendado acompanha o tamanho da sua carteira. Você pode assinar um plano maior,
        mas se a carteira crescer além da faixa contratada nós ajustamos para a faixa correta na
        virada do mês. Cancelar é um clique, sem fidelidade.
      </p>
    </section>
  );
}
