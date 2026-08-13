'use client';
// Formulário e histórico do salário mínimo (AdminBalu).
//
// SÓ IMPORTA MÓDULO PURO e a action — `salario-minimo-entrada.ts` não tem
// `server-only` justamente para poder validar dos dois lados. Módulo
// `server-only` importado daqui passa no `tsc --noEmit` e só quebra em runtime
// (armadilha já documentada em `ConfigIaForm.tsx`).
//
// A PRÉVIA DO INSS É O PONTO DA TELA. O admin digita um salário e o que ele
// precisa conferir é o outro número — o que vai para a guia. Mostrar
// "R$ 1.621,00 → INSS R$ 81,05" antes de salvar é o que transforma um erro de
// dedo em algo visível.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CalendarClock, CircleAlert, CircleCheck } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { brl } from '@/lib/fiscal/guia';
import { lerValorBR, validarSalarioMinimo } from '@/lib/fiscal/salario-minimo-entrada';
import { salvarSalarioMinimoAction } from './actions';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'w-full rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

export type LinhaParametro = {
  vigenciaInicio: string;
  valor: number;
  norma: string | null;
};

type Props = {
  linhas: LinhaParametro[];
  emDia: boolean;
  anoCorrente: number;
  /** O que o cálculo usa HOJE — já resolvido no servidor pela mesma função da apuração. */
  vigenteHoje: number;
};

export default function SalarioMinimoForm({ linhas, emDia, anoCorrente, vigenteHoje }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, startTransition] = useTransition();
  const [valor, setValor] = useState('');
  const [vigencia, setVigencia] = useState(`${anoCorrente}-01-01`);
  const [norma, setNorma] = useState('');

  // Mesma validação do servidor, rodando a cada tecla. Não substitui a de lá —
  // duplica de propósito, para o erro aparecer antes do clique.
  const previa = useMemo(() => {
    if (!valor.trim()) return null;
    const n = lerValorBR(valor);
    const v = validarSalarioMinimo({ valor: n, vigenciaInicio: vigencia, norma });
    if (!v.ok) return { erro: v.erro };
    return { valor: n, inss: Number((n * 0.05).toFixed(2)) };
  }, [valor, vigencia, norma]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await salvarSalarioMinimoAction({ valor, vigenciaInicio: vigencia, norma });
      if (r.ok) {
        toast('success', r.mensagem);
        setValor('');
        setNorma('');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div
        className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
          emDia
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-alert/30 bg-alert/10 text-alert'
        }`}
      >
        {emDia ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
        <div>
          {emDia ? (
            <>
              <strong>Em dia.</strong> O cálculo usa hoje {brl(vigenteHoje)} — INSS do MEI{' '}
              {brl(Number((vigenteHoje * 0.05).toFixed(2)))}.
            </>
          ) : (
            <>
              <strong>Desatualizado.</strong> Não há salário mínimo cadastrado para {anoCorrente}. O DAS-MEI
              está sendo estimado com {brl(vigenteHoje)}, de um ano anterior. O mesmo aviso aparece no
              sino do admin todo dia até ser resolvido.
            </>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Salário mínimo (R$)</span>
          <input
            className={campo}
            inputMode="decimal"
            placeholder="1.621,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Vale a partir de</span>
          <input
            className={campo}
            type="date"
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Norma (opcional)</span>
          <input
            className={campo}
            placeholder="Lei nº …"
            value={norma}
            onChange={(e) => setNorma(e.target.value)}
          />
        </label>

        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={enviando || !previa || 'erro' in previa}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {enviando && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </button>

          {previa && 'erro' in previa && (
            <span className="text-sm text-destructive">{previa.erro}</span>
          )}
          {previa && !('erro' in previa) && (
            <span className="text-sm text-muted-foreground">
              {brl(previa.valor)} → <strong className="text-foreground">INSS {brl(previa.inss)}</strong> por mês
              {vigencia > new Date().toISOString().slice(0, 10) && (
                <> · entra sozinho em {vigencia.split('-').reverse().join('/')}</>
              )}
            </span>
          )}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Cadastrar uma data futura é o caminho normal: o valor fica agendado e passa a valer sozinho na
        data, sem publicação de versão. Reenviar uma vigência que já existe corrige aquele ano — e a
        correção fica no registro de auditoria.
      </p>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarClock className="size-4 shrink-0 text-primary" />
          Histórico e agendamentos
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Vale a partir de</th>
                <th className="py-2 pr-4 font-medium">Salário mínimo</th>
                <th className="py-2 pr-4 font-medium">INSS do MEI</th>
                <th className="py-2 font-medium">Norma</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const futura = l.vigenciaInicio > new Date().toISOString().slice(0, 10);
                return (
                  <tr key={l.vigenciaInicio} className="border-b border-border/50">
                    <td className="py-2 pr-4 tabular-nums">
                      {l.vigenciaInicio.split('-').reverse().join('/')}
                      {futura && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">agendado</span>}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{brl(l.valor)}</td>
                    <td className="py-2 pr-4 tabular-nums">{brl(Number((l.valor * 0.05).toFixed(2)))}</td>
                    <td className="py-2 text-muted-foreground">{l.norma ?? '—'}</td>
                  </tr>
                );
              })}
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-muted-foreground">
                    Nenhum valor cadastrado — o cálculo está usando o valor de reserva do sistema.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
