// src/app/(auth)/aceite/AceiteClient.tsx
'use client';
import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import MarkdownLegal from '@/components/MarkdownLegal';
import { aceitarDocumentosAction } from './actions';

export type DocumentoPendente = {
  tipo: string;
  titulo: string;
  versao: string;
  conteudoMd: string;
};

type Props = { documentos: DocumentoPendente[] };

export default function AceiteClient({ documentos }: Props) {
  const toast = useToast();
  const [concordo, setConcordo] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleAceitar() {
    if (!concordo || isPending) return;
    startTransition(async () => {
      const r = await aceitarDocumentosAction();
      if (!r.ok) {
        toast('error', r.error);
        return;
      }
      toast('success', 'Aceite registrado.');
      // Navegação full-page (não SPA): o router cache ainda tem payloads antigos
      // com redirect pra /aceite; o document request deixa o servidor decidir o
      // destino certo (dashboard ou /onboarding) já sem a pendência.
      window.location.assign('/');
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold text-foreground mb-1">Atualizamos nossos termos</h1>
      <p className="text-sm text-muted-foreground-2 mb-6">
        Pra continuar usando o Balu, leia e aceite o(s) documento(s) abaixo.
      </p>

      <div className="space-y-6">
        {documentos.map((doc) => (
          <div key={doc.tipo} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">{doc.titulo}</p>
              <span className="text-xs text-muted-foreground">versão {doc.versao}</span>
            </div>
            {/* Mesmo motivo da página pública: quem está ACEITANDO um documento
                jurídico precisa conseguir lê-lo. O markdown cru era pior aqui
                do que lá, porque aqui há um botão de concordar embaixo. */}
            <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-2 p-3">
              <MarkdownLegal md={doc.conteudoMd} />
            </div>
          </div>
        ))}
      </div>

      <label className="mt-6 flex min-h-6 items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={concordo}
          onChange={(e) => setConcordo(e.target.checked)}
          className="size-4 rounded border-border"
        />
        Li e concordo com o(s) documento(s) acima.
      </label>

      <button
        type="button"
        onClick={handleAceitar}
        disabled={!concordo || isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        <CheckCircle2 className="size-4" />
        {isPending ? 'Registrando...' : 'Aceitar e continuar'}
      </button>
    </div>
  );
}
