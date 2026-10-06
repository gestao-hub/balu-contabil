'use client';
// "Gerar guia oficial" do MEI pela Receita (PGMEI / GERARDASPDF21).
//
// A action `gerarDasMeiAction` existia desde o Bloco 5 e NÃO tinha botão: o MEI
// só via a guia calculada pela Balu, sem código de barras oficial. Análise de
// 06/10/2026, prioridade 3. A guia oficial (número, linha digitável e PDF da
// Receita) substitui a calculada da mesma competência.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarDasMeiAction } from './actions';

export default function GerarDasMeiButton({ competencia }: { competencia: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function gerar() {
    start(async () => {
      const r = await gerarDasMeiAction(competencia);
      if (!r.ok) { toast('error', r.error); return; }
      toast(r.semValor ? 'info' : 'success', r.semValor
        ? 'A Receita não tem valor a pagar nesta competência.'
        : 'Guia oficial gerada pela Receita.');
      router.refresh();
    });
  }

  return (
    <button
      type="button" onClick={gerar} disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {pending ? 'Gerando na Receita…' : 'Gerar guia oficial (Receita)'}
    </button>
  );
}
