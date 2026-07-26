// Registro do recibo baixado do portal. Serve DASN e DEFIS: recebe a função de
// submit já ligada à action certa (empresário ou contador).
'use client';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { MAX_COMPROVANTE_BYTES } from '@/lib/fiscal/declaracoes-anuais/comprovante';

const MIMES_ACEITOS = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Base64 em blocos. `String.fromCharCode(...bytes)` de uma vez estoura a pilha
 * bem antes dos 5 MB que o campo aceita — o spread vira um argumento por byte.
 */
function paraBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const BLOCO = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(bin);
}

export type SubmitComprovante = (input: {
  numeroDeclaracao: string;
  dataTransmissao: string;
  comprovante: { nome: string; mime: string; base64: string } | null;
}) => Promise<{ ok: boolean; error?: string }>;

export default function RegistrarComprovanteDialog({ onSubmit, disabled }: {
  onSubmit: SubmitComprovante;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [numero, setNumero] = useState('');
  const [data, setData] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setErro(null);
    if (!data) { setErro('Informe a data de transmissão.'); return; }
    // Mesmas regras de validarComprovante(), antecipadas: erra em 0 ms em vez de
    // depois de trafegar megabytes. O servidor revalida de qualquer forma.
    if (arquivo) {
      if (!MIMES_ACEITOS.includes(arquivo.type)) { setErro('O comprovante precisa ser PDF, PNG ou JPEG.'); return; }
      if (arquivo.size <= 0) { setErro('O arquivo está vazio.'); return; }
      if (arquivo.size > MAX_COMPROVANTE_BYTES) { setErro('O comprovante passa de 5 MB.'); return; }
    }
    setEnviando(true);
    try {
      let comprovante = null;
      if (arquivo) {
        const buf = await arquivo.arrayBuffer();
        comprovante = { nome: arquivo.name, mime: arquivo.type, base64: paraBase64(buf) };
      }
      const r = await onSubmit({ numeroDeclaracao: numero.trim(), dataTransmissao: data, comprovante });
      if (!r.ok) { setErro(r.error ?? 'Falha ao registrar.'); return; }
      setAberto(false);
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
      >
        <Upload className="size-4" />
        Registrar comprovante
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-surface-2 p-3 space-y-3">
      <label className="block text-sm">
        <span className="text-muted-foreground">Nº da declaração</span>
        <input value={numero} onChange={(e) => setNumero(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Data de transmissão *</span>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Comprovante (PDF, PNG ou JPEG, até 5 MB)</span>
        <input type="file" accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm" />
      </label>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={enviar} disabled={enviando}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {enviando ? 'Registrando…' : 'Registrar'}
        </button>
        <button type="button" onClick={() => setAberto(false)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-3">
          Cancelar
        </button>
      </div>
    </div>
  );
}
