'use client';
// Comprovante de pagamento de uma guia (P3.5). Client island: precisa de
// <input type="file">, leitura local e transição.
//
// SÓ IMPORTA MÓDULO PURO (`lib/fiscal/comprovante-guia`) e as actions —
// `server-only` importado daqui passa no `tsc` e só quebra em runtime.
//
// NÃO EXISTE BOTÃO DE REMOVER, e é decisão, não esquecimento. Comprovante é
// prova de pagamento; apagar prova por engano é o tipo de perda que só aparece
// quando a Receita cobra uma guia já paga — exatamente quando ela fazia falta.
// Anexar de novo substitui, o que cobre o caso real (subiu o arquivo errado)
// sem oferecer a porta para o caso ruim.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { MAX_COMPROVANTE_GUIA_BYTES, validarComprovanteGuia } from '@/lib/fiscal/comprovante-guia';
import { anexarComprovanteGuiaAction, urlComprovanteGuiaAction } from './actions';

const botao =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground-2 transition hover:bg-surface-2 disabled:opacity-50';

/** `File` → base64 sem o prefixo `data:` — é o que a action espera. */
function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    fr.onload = () => {
      const r = String(fr.result ?? '');
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    fr.readAsDataURL(arquivo);
  });
}

export default function ComprovanteGuia({
  guiaId, nomeAtual,
}: { guiaId: string; nomeAtual: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [enviando, startTransition] = useTransition();
  const [baixando, setBaixando] = useState(false);

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Zera o input SEMPRE: sem isso, escolher o mesmo arquivo depois de um erro
    // não dispara `change` de novo e a tela fica muda.
    e.target.value = '';
    if (!arquivo) return;

    // A mesma validação do servidor, antes de subir 5 MB para ouvir "não".
    const v = validarComprovanteGuia({ mime: arquivo.type, tamanho: arquivo.size });
    if (!v.ok) { toast('error', v.error); return; }

    startTransition(async () => {
      try {
        const base64 = await lerBase64(arquivo);
        const r = await anexarComprovanteGuiaAction({
          guiaId, nome: arquivo.name, mime: arquivo.type, base64,
        });
        if (r.ok) {
          toast('success', nomeAtual ? 'Comprovante substituído.' : 'Comprovante anexado.');
          router.refresh();
        } else {
          toast('error', r.error);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Falha ao enviar o comprovante.');
      }
    });
  }

  async function baixar() {
    setBaixando(true);
    try {
      const r = await urlComprovanteGuiaAction(guiaId);
      // A URL é pedida no clique e usada na hora — nunca guardada em estado nem
      // renderizada no HTML da lista.
      if (r.ok) window.location.href = r.url;
      else toast('error', r.error);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={escolher}
      />

      {nomeAtual && (
        <button type="button" onClick={baixar} disabled={baixando} className={botao}>
          {baixando ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          <span className="max-w-[14rem] truncate">{nomeAtual}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
        className={botao}
      >
        {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
        {nomeAtual ? 'Trocar comprovante' : 'Anexar comprovante'}
      </button>

      {!nomeAtual && (
        <span className="text-xs text-muted-foreground">
          PDF, PNG ou JPEG, até {Math.round(MAX_COMPROVANTE_GUIA_BYTES / (1024 * 1024))} MB.
        </span>
      )}
    </div>
  );
}
