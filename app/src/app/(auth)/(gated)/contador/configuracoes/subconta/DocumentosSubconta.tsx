'use client';
// O que o Asaas ainda pede para aprovar a conta de recebimento, e o envio.
//
// FOTO É REDUZIDA AQUI, NO NAVEGADOR. Foto de celular passa fácil de 4 MB, e a
// Vercel recusa o corpo acima de ~4,5 MB antes de o Next ver a requisição — o
// escritório receberia um erro sem explicação. Reduzir para 2000 px em JPEG
// mantém o documento legível para a análise e cabe com folga. PDF vai como está.
//
// Só importa módulo puro e a action.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, FileUp, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import {
  ROTULO_STATUS_DOCUMENTO, validarArquivoDocumento,
  type GrupoDocumentoVm, type StatusDocumento,
} from '@/lib/billing/documentos-subconta';
import { enviarDocumentoSubcontaAction } from './documentos-actions';

type Props = {
  grupos: GrupoDocumentoVm[];
  motivoRecusa: string | null;
  /** Só quem abriu a conta envia — são os documentos dele. */
  ehDono: boolean;
};

const LADO_MAXIMO = 2000;

/** Reduz uma foto para JPEG de até `LADO_MAXIMO` px. Se o navegador não
 *  conseguir decodificar (ex.: HEIC no Chrome), devolve o arquivo original e
 *  a validação de tipo explica o que fazer. */
async function prepararArquivo(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f;
  try {
    const bitmap = await createImageBitmap(f);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'documento.jpg', { type: 'image/jpeg' }) : f;
  } catch {
    return f;
  }
}

const ICONE: Record<StatusDocumento, typeof Clock> = {
  NOT_SENT: AlertTriangle,
  PENDING: Clock,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  IGNORED: CheckCircle2,
};

const COR: Record<StatusDocumento, string> = {
  NOT_SENT: 'text-alert',
  PENDING: 'text-muted-foreground-2',
  APPROVED: 'text-success',
  REJECTED: 'text-destructive',
  IGNORED: 'text-muted-foreground',
};

function LinhaDocumento({ g, ehDono }: { g: GrupoDocumentoVm; ehDono: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const Icone = ICONE[g.status];

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois de um erro
    if (!original) return;
    setErro(null);
    const arquivo = await prepararArquivo(original);
    const invalido = validarArquivoDocumento(arquivo);
    if (invalido) { setErro(invalido); return; }

    const fd = new FormData();
    fd.append('grupoId', g.grupoId);
    fd.append('arquivo', arquivo);
    start(async () => {
      const r = await enviarDocumentoSubcontaAction(fd);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', 'Documento enviado ao Asaas.');
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{g.titulo}</p>
        <p className={`mt-0.5 flex items-center gap-1.5 text-xs font-medium ${COR[g.status]}`}>
          <Icone className="size-3.5" /> {ROTULO_STATUS_DOCUMENTO[g.status]}
          {g.responsavel && <span className="font-normal text-muted-foreground">· de {g.responsavel}</span>}
        </p>
        {g.descricao && g.podeEnviar && (
          <p className="mt-1 text-xs text-muted-foreground">{g.descricao}</p>
        )}
        {erro && <p role="alert" className="mt-1 text-xs text-destructive">{erro}</p>}
      </div>

      {g.linkEnvio ? (
        <a
          href={g.linkEnvio} target="_blank" rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
          Enviar no Asaas <ExternalLink className="size-3.5" />
        </a>
      ) : g.podeEnviar && ehDono ? (
        <>
          <input
            ref={input} type="file" className="hidden"
            accept="image/jpeg,image/png,application/pdf,image/*"
            onChange={escolher}
          />
          <button
            type="button" onClick={() => input.current?.click()} disabled={pending}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {pending ? 'Enviando…' : g.status === 'REJECTED' ? 'Enviar de novo' : 'Enviar arquivo'}
          </button>
        </>
      ) : null}
    </li>
  );
}

export default function DocumentosSubconta({ grupos, motivoRecusa, ehDono }: Props) {
  const router = useRouter();
  const [atualizando, start] = useTransition();
  const faltam = grupos.filter((g) => g.status === 'NOT_SENT' || g.status === 'REJECTED').length;

  return (
    <section className="mt-6 space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Documentos para aprovar a conta</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {faltam > 0
              ? `O Asaas só começa a análise depois que ${faltam === 1 ? 'este documento chega' : `estes ${faltam} documentos chegam`}. `
                + 'O arquivo vai direto para o Asaas — a Balu não guarda cópia.'
              : 'Tudo enviado. A análise é do Asaas e costuma levar de 1 a 2 dias úteis.'}
          </p>
        </div>
        <button
          type="button" onClick={() => start(() => router.refresh())} disabled={atualizando}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${atualizando ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {motivoRecusa && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Motivo informado pelo Asaas: {motivoRecusa}
        </p>
      )}

      {!ehDono && faltam > 0 && (
        <p className="text-xs text-muted-foreground">
          Quem abriu a conta de recebimento é quem envia estes documentos — peça a essa pessoa para
          entrar aqui.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {grupos.map((g) => <LinhaDocumento key={g.grupoId} g={g} ehDono={ehDono} />)}
      </ul>
    </section>
  );
}
