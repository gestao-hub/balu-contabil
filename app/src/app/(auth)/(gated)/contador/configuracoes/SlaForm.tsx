'use client';
// Prazo de resposta (SLA) do escritório — Bloco 7, Frente 2.
//
// Era metade do `DominioSlaForm`; a outra metade (domínio próprio) foi
// arquivada em 12/08/2026 (ver docs/arquivo/2026-08-12-dominio-proprio-README.md).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { salvarSlaAction } from '../sla-actions';

export type SlaInicial = { sla_resposta_horas: number | null };

export default function SlaForm({ initial }: { initial: SlaInicial }) {
  const router = useRouter();
  const toast = useToast();
  const [sla, setSla] = useState(initial.sla_resposta_horas?.toString() ?? '');
  const [pendente, iniciar] = useTransition();

  function salvar() {
    const limpo = sla.trim();
    const valor = limpo === '' ? null : Number(limpo);
    iniciar(async () => {
      const r = await salvarSlaAction(valor);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', valor === null ? 'SLA removido.' : `SLA de ${valor}h salvo.`);
      router.refresh();
    });
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Clock className="size-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Prazo de resposta (SLA)</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Em quantas horas seu escritório se compromete a responder um atendimento. O prazo é
        exibido aos seus clientes e vale em <strong>horas corridas</strong>. Deixe em branco para
        não exibir prazo nenhum.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Horas</span>
          <input
            type="number" min={1} max={720} value={sla}
            onChange={(e) => setSla(e.target.value)}
            placeholder="24"
            className="w-32 rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
        </label>
        <button
          type="button" onClick={salvar} disabled={pendente}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar prazo
        </button>
      </div>
    </section>
  );
}
