'use client';
// "Atualizar com a Receita" do Simples (PGDAS-D / CONSDECLARACAO13 + pagamentos).
//
// A consulta só tinha porta na PRIMEIRA vez (`GateInicialSerpro`): depois da
// sincronização inicial o botão sumia, e a única atualização era a varredura
// de pagamentos do cron — declaração transmitida fora da Balu nunca aparecia.
// Análise de 06/10/2026, prioridade 3.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDeclaracoesAction } from './actions';

export default function AtualizarComReceitaButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function atualizar() {
    start(async () => {
      const r = await consultarDeclaracoesAction();
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', r.count ? `Atualizado com a Receita (${r.count} competência(s)).` : 'Atualizado com a Receita.');
      if (r.avisoBaixas) toast('warning', r.avisoBaixas);
      router.refresh();
    });
  }

  return (
    <button
      type="button" onClick={atualizar} disabled={pending}
      title="Buscar na Receita as declarações (PGDAS-D) e guias do ano"
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {pending ? 'Consultando a Receita…' : 'Atualizar com a Receita'}
    </button>
  );
}
