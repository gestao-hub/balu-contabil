'use client';
// Bloco 7, Task 6 — a fila em si. Client component só por causa do botão;
// os dados vêm todos do server component.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, MessageSquare } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { marcarAtendidoAction } from './actions';

export type EscaladaVM = {
  id: string;
  telefone: string;
  mensagem: string;
  criadoEm: string;
  horasEsperando: number;
  estourouSla: boolean;
};

export default function FilaAtendimentos({ itens, slaHoras }: { itens: EscaladaVM[]; slaHoras: number | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pendente, iniciar] = useTransition();

  function marcar(id: string) {
    iniciar(async () => {
      const r = await marcarAtendidoAction(id);
      if (!r.ok) { toast('error', r.error); router.refresh(); return; }
      toast('success', 'Atendimento marcado como respondido.');
      router.refresh();
    });
  }

  if (itens.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum cliente aguardando resposta. Quando a IA não souber responder algo no WhatsApp,
          a conversa aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {itens.map((e) => (
        <li
          key={e.id}
          className={`rounded-md border bg-surface p-3 ${e.estourouSla ? 'border-destructive/50' : 'border-border'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{e.telefone}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    e.estourouSla ? 'bg-destructive/10 text-destructive' : 'bg-alert/10 text-alert'
                  }`}
                >
                  esperando há {e.horasEsperando}h
                  {e.estourouSla && slaHoras ? ` · acima do prazo de ${slaHoras}h` : ''}
                </span>
              </div>
              <p className="mt-1 flex gap-1.5 text-sm text-muted-foreground">
                <MessageSquare className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 break-words">{e.mensagem}</span>
              </p>
            </div>
            <button
              type="button" onClick={() => marcar(e.id)} disabled={pendente}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Marcar respondido
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
