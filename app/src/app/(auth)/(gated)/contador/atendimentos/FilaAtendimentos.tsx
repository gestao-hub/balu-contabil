'use client';
// Bloco 7, Task 6 — a fila em si. Client component por causa dos botões;
// os dados vêm todos do server component.
//
// "Responder" (06/10/2026): a resposta sai pelo WhatsApp DO ESCRITÓRIO
// conectado à plataforma (ver `responderAtendimentoAction`) e fecha o
// atendimento. "Marcar respondido" continua para quem já resolveu por outro
// canal (ligação, e-mail).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, MessageSquare, Reply, Send, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { marcarAtendidoAction, responderAtendimentoAction } from './actions';

export type EscaladaVM = {
  id: string;
  telefone: string;
  mensagem: string;
  criadoEm: string;
  horasEsperando: number;
  estourouSla: boolean;
};

/** Telefone legível: 5532987006789 → (32) 98700-6789. */
function telefoneBonito(t: string): string {
  const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

/**
 * Um item da fila. No topo do módulo, e não dentro do componente de baixo:
 * componente declarado dentro de outro é um tipo novo a cada render, e o texto
 * digitado na caixa de resposta se perderia a cada tecla.
 */
function ItemFila({ e, slaHoras }: { e: EscaladaVM; slaHoras: number | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pendente, iniciar] = useTransition();
  const [respondendo, setRespondendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function marcar() {
    iniciar(async () => {
      const r = await marcarAtendidoAction(e.id);
      if (!r.ok) { toast('error', r.error); router.refresh(); return; }
      toast('success', 'Atendimento marcado como respondido.');
      router.refresh();
    });
  }

  function enviar() {
    setErro(null);
    if (!texto.trim()) { setErro('Escreva a resposta.'); return; }
    iniciar(async () => {
      const r = await responderAtendimentoAction(e.id, texto);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', 'Resposta enviada pelo WhatsApp do escritório.');
      setTexto('');
      setRespondendo(false);
      router.refresh();
    });
  }

  return (
    <li className={`rounded-md border bg-surface p-3 ${e.estourouSla ? 'border-destructive/50' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{telefoneBonito(e.telefone)}</span>
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

        {!respondendo && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button" onClick={() => { setRespondendo(true); setErro(null); }} disabled={pendente}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Reply className="size-4" /> Responder
            </button>
            <button
              type="button" onClick={marcar} disabled={pendente}
              title="Para quando você já respondeu por outro canal"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Marcar respondido
            </button>
          </div>
        )}
      </div>

      {respondendo && (
        <div className="mt-3 space-y-2">
          <textarea
            value={texto}
            onChange={(ev) => setTexto(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) enviar(); }}
            rows={3}
            maxLength={2000}
            autoFocus
            placeholder="Escreva a resposta para o cliente…"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={enviar} disabled={pendente}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {pendente ? 'Enviando…' : 'Enviar pelo WhatsApp'}
            </button>
            <button
              type="button" onClick={() => { setRespondendo(false); setErro(null); }} disabled={pendente}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 disabled:opacity-50"
            >
              <X className="size-4" /> Cancelar
            </button>
            <p className="text-xs text-muted-foreground">
              Sai pelo WhatsApp do escritório conectado à Balu, e o atendimento é encerrado.
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

export default function FilaAtendimentos({ itens, slaHoras }: { itens: EscaladaVM[]; slaHoras: number | null }) {
  if (itens.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum cliente aguardando resposta. Quando a IA não souber responder algo no WhatsApp,
          ou o cliente pedir para falar com a equipe, a conversa aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {itens.map((e) => <ItemFila key={e.id} e={e} slaHoras={slaHoras} />)}
    </ul>
  );
}
