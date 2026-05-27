'use client';
// @custom — PR 1.6: aba "Certificado A1" das Configurações (PRD §8).
// Upload de .pfx/.p12 + senha → Storage + arquivos_auxiliares + n8n (best-effort).
import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { uploadCertificadoAction } from './actions';

export default function CertificadoForm({ enviadoEm }: { enviadoEm: string | null }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false); // latch síncrono contra duplo-envio
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sobe o certificado de fato. Fecha o modal ao terminar; reseta o form só no sucesso.
  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (uploadingRef.current) return; // ignora duplo-clique antes do re-render
    uploadingRef.current = true;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('senha', senha);
      const r = await uploadCertificadoAction(fd);
      if (!r.ok) { toast('error', r.error); return; }
      if (r.warning) toast('warning', r.warning);
      else toast('success', 'Certificado enviado.');
      setSenha('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast('error', 'Erro inesperado ao enviar o certificado.');
      console.error(err);
    } finally {
      uploadingRef.current = false;
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast('warning', 'Selecione o arquivo do certificado (.pfx).'); return; }
    if (!senha.trim()) { toast('warning', 'Informe a senha do certificado.'); return; }
    if (enviadoEm) setConfirmOpen(true); // substituição → confirma antes
    else void doUpload();                // primeiro envio → direto
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
      <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <ShieldCheck className={`size-5 ${enviadoEm ? 'text-success' : 'text-zinc-400'}`} />
        <span className="text-zinc-700">
          {enviadoEm
            ? `Certificado enviado em ${new Date(enviadoEm).toLocaleString('pt-BR')}.`
            : 'Nenhum certificado enviado.'}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">Arquivo do certificado (.pfx / .p12)</span>
        <input
          ref={fileRef}
          type="file"
          accept=".pfx,.p12"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">Senha do certificado</span>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="off"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <span className="text-[11px] text-zinc-400">A senha não é exibida novamente após o envio.</span>
      </label>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {enviadoEm ? 'Substituir certificado' : 'Enviar certificado'}
        </button>
      </div>
    </form>

      <PopupConfirm
        open={confirmOpen}
        variant="destructive"
        title="Substituir certificado?"
        description="A troca do certificado afeta a emissão de notas fiscais e os fluxos que dependem dele. Confirme que o novo arquivo (.pfx/.p12) e a senha estão corretos e válidos antes de continuar."
        confirmLabel="Substituir certificado"
        cancelLabel="Cancelar"
        busy={busy}
        onConfirm={doUpload}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
