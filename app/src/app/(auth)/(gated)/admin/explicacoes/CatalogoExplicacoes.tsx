'use client';
// Bloco 6A — o catálogo de explicações (AdminBalu).
//
// SÓ IMPORTA DE MÓDULO PURO e das actions. Módulo com `server-only` importado
// daqui passa no `tsc --noEmit` e só quebra no runtime — mordeu o Bloco 4A.
//
// A TELA É A REVISÃO HUMANA. É o único ponto do sistema entre um texto sobre
// tributo e o cliente que vai lê-lo, e por isso ela mostra o texto inteiro, os
// marcadores que a situação fornece e de onde o rascunho veio — em vez de um
// botão "aprovar" ao lado de um resumo.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Eye, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarRascunhoAction, salvarTextoAction, aprovarExplicacaoAction } from './actions';

export type ItemCatalogo = {
  chave: string;
  rotulo: string;
  marcadores: string[];
  texto: string;
  status: 'rascunho' | 'aprovado' | 'ausente';
  geradoPor: string | null;
  aprovadoEm: string | null;
  /** Quantas vezes a tela do cliente pediu esta situação sem achar texto. */
  vistas: number;
};

type Props = {
  itens: ItemCatalogo[];
  /** Sem provedor configurado não há como gerar — e isso é dito na entrada da
   *  tela, não depois do clique. */
  temProvedorIa: boolean;
};

const CAIXA = 'rounded-md border border-border bg-surface p-4';

export default function CatalogoExplicacoes({ itens, temProvedorIa }: Props) {
  if (!itens.length) {
    return (
      <div className={`${CAIXA} text-sm text-muted-foreground`}>
        Nenhuma situação fiscal no catálogo ainda. As situações aparecem aqui sozinhas
        assim que a tela de impostos de algum cliente pedir uma explicação que não existe.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {itens.map((item) => (
        <LinhaExplicacao key={item.chave} item={item} temProvedorIa={temProvedorIa} />
      ))}
    </div>
  );
}

function LinhaExplicacao({ item, temProvedorIa }: { item: ItemCatalogo; temProvedorIa: boolean }) {
  const [texto, setTexto] = useState(item.texto);
  const [pendente, iniciar] = useTransition();
  const [gerando, setGerando] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const permitidos = new Set(item.marcadores);
  // O aviso aparece enquanto o admin digita, não no envio: descobrir que o
  // texto é irrecusável só depois de clicar "Aprovar" é a queixa que o Bloco 4A
  // gerou.
  const intrusos = [...new Set(Array.from(texto.matchAll(/\{([a-z0-9_]+)\}/gi), (m) => m[1]))]
    .filter((m) => !permitidos.has(m));
  const sujo = texto !== item.texto;
  const ocupado = pendente || gerando;

  function agir(fn: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) {
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) { toast('error', r.error ?? 'Não foi possível concluir.'); return; }
      toast('success', sucesso);
      router.refresh();
    });
  }

  async function handleGerar() {
    setGerando(true);
    try {
      const r = await gerarRascunhoAction(item.chave);
      if (!r.ok) { toast('error', r.error); return; }
      if (r.marcadoresIntrusos.length) {
        toast('warning', `O rascunho usa ${r.marcadoresIntrusos.map((m) => `{${m}}`).join(', ')}, que esta situação não fornece. Corrija antes de aprovar.`);
      } else {
        toast('success', 'Rascunho gerado. Leia antes de aprovar.');
      }
      router.refresh();
    } finally {
      setGerando(false);
    }
  }

  return (
    <section className={CAIXA}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground">{item.rotulo}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{item.chave}</p>
        </div>
        <Selo status={item.status} vistas={item.vistas} />
      </header>

      <p className="mt-3 text-xs text-muted-foreground">
        Marcadores desta situação:{' '}
        {item.marcadores.length
          ? item.marcadores.map((m) => <code key={m} className="mr-1">{`{${m}}`}</code>)
          : 'nenhum'}
        {' '}— a Balu troca cada um pelo valor do cliente na hora de exibir.
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        placeholder="Escreva a explicação, em duas a quatro frases, usando os marcadores acima."
        className="mt-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
      />

      {intrusos.length > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {intrusos.map((m) => `{${m}}`).join(', ')} não existe nesta situação. A aprovação
            será recusada enquanto estiver no texto.
          </span>
        </p>
      )}

      {item.status === 'aprovado' && sujo && (
        <p className="mt-1 text-xs text-warning">
          Salvar esta edição derruba a aprovação, e a explicação some da tela do cliente
          até ser aprovada de novo.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={ocupado || !texto.trim()}
          onClick={() => agir(() => salvarTextoAction({ chave: item.chave, texto }), 'Rascunho salvo.')}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          {pendente && <Loader2 className="size-4 animate-spin" />}
          Salvar rascunho
        </button>

        <button
          type="button"
          disabled={ocupado || !texto.trim() || intrusos.length > 0}
          onClick={() => agir(() => aprovarExplicacaoAction({ chave: item.chave, texto }), 'Aprovada. Já aparece para os clientes nesta situação.')}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity disabled:opacity-60"
        >
          <Check className="size-4" />
          Aprovar
        </button>

        <button
          type="button"
          onClick={handleGerar}
          disabled={ocupado || !temProvedorIa || item.status === 'aprovado'}
          title={
            !temProvedorIa ? 'Configure o provedor de IA para gerar rascunho.'
              : item.status === 'aprovado' ? 'Edite o texto para derrubar a aprovação antes de gerar outro.'
                : undefined
          }
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          {gerando ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Gerar com IA
        </button>

        {item.geradoPor && (
          <span className="text-xs text-muted-foreground">rascunho redigido por {item.geradoPor}</span>
        )}
      </div>
    </section>
  );
}

function Selo({ status, vistas }: { status: ItemCatalogo['status']; vistas: number }) {
  if (status === 'aprovado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
        <Check className="size-3" /> aprovada
      </span>
    );
  }
  if (status === 'rascunho') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
        rascunho — o cliente não vê
      </span>
    );
  }
  // Ausente: a situação foi PEDIDA pela tela de algum cliente e não existe.
  // A contagem é o que faz o catálogo crescer por demanda real.
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
      <Eye className="size-3" /> sem texto · {vistas} {vistas === 1 ? 'vez' : 'vezes'}
    </span>
  );
}
