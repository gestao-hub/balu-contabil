'use client';
// Saldo + saque da subconta. Só aparece para o dono da subconta e com a conta
// aprovada — quem não pode sacar não vê a caixa, para não descobrir o limite
// por tentativa e erro.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Loader2, Save, ArrowUpRight, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { formatBRL } from '@/lib/format/dinheiro';
import { consultarSaldoAction, salvarContaDestinoAction, sacarAction } from './saque-actions';

export type SaqueHistorico = {
  id: string;
  valorCentavos: number;
  status: 'solicitado' | 'confirmado' | 'falhou';
  destinoResumo: string | null;
  criadoEm: string;
};

type Props = {
  ehDono: boolean;
  contaResumo: string | null;
  historico: SaqueHistorico[];
};

const ROTULO: Record<SaqueHistorico['status'], string> = {
  solicitado: 'Em processamento',
  confirmado: 'Concluído',
  falhou: 'Falhou',
};

export default function SaldoSaque({ ehDono, contaResumo, historico }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pendente, iniciar] = useTransition();
  const [saldo, setSaldo] = useState<number | null>(null);
  const [carregandoSaldo, setCarregandoSaldo] = useState(true);
  const [valor, setValor] = useState('');
  const [form, setForm] = useState({
    bancoCodigo: '', bancoNome: '', agencia: '', conta: '', contaDigito: '',
    tipo: 'CONTA_CORRENTE' as 'CONTA_CORRENTE' | 'CONTA_POUPANCA', titular: '', cpfCnpj: '',
  });
  const [editandoConta, setEditandoConta] = useState(!contaResumo);

  async function carregarSaldo() {
    setCarregandoSaldo(true);
    const r = await consultarSaldoAction();
    setSaldo(r.ok ? (r.data?.centavos ?? 0) : null);
    if (!r.ok) toast('error', r.error);
    setCarregandoSaldo(false);
  }

  useEffect(() => {
    if (ehDono) carregarSaldo();
    else setCarregandoSaldo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehDono]);

  if (!ehDono) {
    return (
      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Wallet className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Saldo e saques</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Apenas quem abriu a conta de recebimento movimenta o saldo. Fale com essa pessoa
          do escritório para solicitar um saque.
        </p>

        {/* O histórico APARECE para o time todo — é o que a policy da 0073
            concede de propósito ("todos veem o que saiu"). Esconder dinheiro
            que sai da conta do escritório de quem trabalha nele seria o
            contrário da transparência que a tabela existe para dar. */}
        {historico.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            {historico.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{formatBRL(s.valorCentavos)}</span>
                <span className="text-muted-foreground">
                  {new Date(s.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={s.status === 'falhou' ? 'text-destructive' : s.status === 'confirmado' ? 'text-primary' : 'text-alert'}>
                  {ROTULO[s.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  function salvarConta() {
    iniciar(async () => {
      const r = await salvarContaDestinoAction(form);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Conta de destino salva.');
      setEditandoConta(false);
      router.refresh();
    });
  }

  function sacar() {
    const centavos = Math.round(Number(valor.replace(',', '.')) * 100);
    if (!Number.isFinite(centavos) || centavos <= 0) { toast('error', 'Informe o valor do saque.'); return; }
    if (saldo !== null && centavos > saldo) { toast('error', 'Valor maior que o saldo disponível.'); return; }
    if (!contaResumo) { toast('error', 'Cadastre a conta de destino antes.'); return; }
    // Confirmação explícita: é dinheiro saindo, e o Asaas não desfaz.
    if (!window.confirm(`Transferir ${formatBRL(centavos)} para:\n${contaResumo}\n\nEsta operação não pode ser desfeita.`)) return;

    iniciar(async () => {
      const r = await sacarAction(centavos);
      if (!r.ok) { toast('error', r.error); router.refresh(); return; }
      toast('success', 'Transferência solicitada.');
      setValor('');
      await carregarSaldo();
      router.refresh();
    });
  }

  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Wallet className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Saldo disponível</h2>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <span className="text-3xl font-semibold text-foreground">
            {carregandoSaldo ? '—' : saldo === null ? 'indisponível' : formatBRL(saldo)}
          </span>
          <button
            type="button" onClick={carregarSaldo} disabled={carregandoSaldo}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {carregandoSaldo ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Atualizar
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          É o valor que o Asaas considera sacável agora — recebimentos recentes ainda podem
          estar em prazo de liberação, e as tarifas já estão descontadas.
        </p>
      </div>

      {/* ── conta de destino ── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-1 font-semibold text-foreground">Conta para receber</h3>
        {contaResumo && !editandoConta ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{contaResumo}</p>
            <button
              type="button" onClick={() => setEditandoConta(true)}
              className="text-sm font-medium text-primary hover:underline"
            >
              Trocar conta
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Cadastre uma vez; nos saques seguintes você só confirma o valor.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['bancoCodigo', 'Código do banco (ex.: 341)'],
                ['bancoNome', 'Nome do banco'],
                ['agencia', 'Agência'],
                ['conta', 'Conta'],
                ['contaDigito', 'Dígito'],
                ['titular', 'Titular da conta'],
                ['cpfCnpj', 'CPF/CNPJ do titular'],
              ] as const).map(([campo, rotulo]) => (
                <label key={campo} className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{rotulo}</span>
                  <input
                    value={form[campo]}
                    onChange={(e) => setForm((p) => ({ ...p, [campo]: e.target.value }))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Tipo</span>
                <select
                  value={form.tipo}
                  onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value as typeof p.tipo }))}
                  className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
                >
                  <option value="CONTA_CORRENTE">Conta corrente</option>
                  <option value="CONTA_POUPANCA">Conta poupança</option>
                </select>
              </label>
            </div>
            <button
              type="button" onClick={salvarConta} disabled={pendente}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar conta
            </button>
          </>
        )}
      </div>

      {/* ── saque ── */}
      {contaResumo && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-semibold text-foreground">Transferir para minha conta</h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Valor (R$)</span>
              <input
                inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                className="w-40 rounded-md border border-border bg-background px-3 py-2 text-foreground"
              />
            </label>
            <button
              type="button" onClick={sacar} disabled={pendente || !valor.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
              Transferir
            </button>
            {saldo !== null && saldo > 0 && (
              <button
                type="button" onClick={() => setValor((saldo / 100).toFixed(2).replace('.', ','))}
                className="text-sm font-medium text-primary hover:underline"
              >
                sacar tudo
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── histórico ── */}
      {historico.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-semibold text-foreground">Saques</h3>
          <ul className="space-y-2 text-sm">
            {historico.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                <span className="font-medium text-foreground">{formatBRL(s.valorCentavos)}</span>
                <span className="text-muted-foreground">
                  {new Date(s.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={s.status === 'falhou' ? 'text-destructive' : s.status === 'confirmado' ? 'text-primary' : 'text-alert'}>
                  {ROTULO[s.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
