'use client';
import { useState, useTransition } from 'react';
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

export default function AssinaturaView({
  assinatura, cobrancas, planos = [],
}: { assinatura: AssinaturaVm; cobrancas: CobrancaVm[]; planos?: PlanoVm[] }) {
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
    !assinatura.contratada && assinatura.status !== 'cortesia' && planos.length > 0;

  return (
    <div className="space-y-6">
      {msg && <p className="text-sm rounded border px-3 py-2">{msg}</p>}

      <section className="border rounded p-4">
        <h2 className="font-medium mb-2">{assinatura.planoNome ?? 'Sem plano definido'}</h2>
        <p className="text-sm">
          Situação: <strong>{ROTULO[assinatura.status] ?? assinatura.status}</strong>
        </p>
        {assinatura.valor_centavos !== null && (
          <p className="text-sm">Valor: {reais(assinatura.valor_centavos)} por mês</p>
        )}
        {assinatura.status === 'trial' && assinatura.trial_termina_em && (
          <p className="text-sm">Teste até {dataBr(assinatura.trial_termina_em)}</p>
        )}
        {assinatura.proxima_cobranca_em && (
          <p className="text-sm">Próxima cobrança em {dataBr(assinatura.proxima_cobranca_em)}</p>
        )}
        {assinatura.status === 'cortesia' && (
          <p className="text-sm text-neutral-600 mt-2">
            Esta conta está liberada como cortesia, sem cobrança e sem prazo.
          </p>
        )}
      </section>

      {podeContratar && (
        <section className="border rounded p-4 space-y-3">
          <h2 className="font-medium">
            {assinatura.status === 'trial' ? 'Contratar agora' : 'Reativar o acesso'}
          </h2>
          <p className="text-sm text-neutral-600">
            {assinatura.status === 'trial'
              ? 'Você pode contratar antes do fim do teste — o período de teste continua valendo até o fim.'
              : 'Contrate um plano para voltar a emitir notas e cadastrar clientes.'}
          </p>

          {planos.length === 1 ? (
            <p className="text-sm">
              <strong>{planos[0].nome}</strong> — {reais(planos[0].valor_centavos)} por mês
            </p>
          ) : (
            <label className="block text-sm">
              Plano
              <select
                className="mt-1 w-full border rounded px-2 py-1"
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
            className="border rounded px-3 py-1 text-sm"
            disabled={pending || !planoEscolhido}
            onClick={assinar}
          >
            {pending ? 'Processando…' : 'Assinar'}
          </button>
          <p className="text-xs text-neutral-500">
            A fatura permite boleto, Pix ou cartão. Você pode cancelar quando quiser.
          </p>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-2">Cobranças</h2>
        {cobrancas.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhuma cobrança ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr><th className="py-2">Vencimento</th><th>Valor</th><th>Situação</th><th></th></tr>
              </thead>
              <tbody>
                {cobrancas.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-2">{dataBr(c.vencimento)}</td>
                    <td>{reais(c.valor_centavos)}</td>
                    <td>{c.status}</td>
                    <td className="text-right">
                      {c.link_fatura && (
                        <a className="underline" href={c.link_fatura} target="_blank" rel="noreferrer">
                          Abrir fatura
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CDC art. 39: cancelar e um clique. Uma confirmacao simples, sem
          tela de retencao, sem "fale com o suporte", sem oferta de desconto
          no caminho. */}
      {!['cancelada', 'cortesia'].includes(assinatura.status) && (
        <section className="border-t pt-4">
          {confirmando ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">Cancelar a assinatura?</span>
              <button className="border rounded px-3 py-1" disabled={pending} onClick={cancelar}>
                Sim, cancelar
              </button>
              <button className="underline" onClick={() => setConfirmando(false)}>Voltar</button>
            </div>
          ) : (
            <button className="underline text-sm" onClick={() => setConfirmando(true)}>
              Cancelar assinatura
            </button>
          )}
        </section>
      )}
    </div>
  );
}
