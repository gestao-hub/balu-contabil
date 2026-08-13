'use client';
// Aba "Certificado" do drill-down: o contador sobe o A1 do cliente (card P11).
//
// É a ÚNICA escrita desta tela sobre dado fiscal do cliente, e por isso ela
// carrega a declaração de autorização em vez de ser só um input de arquivo: a
// chave privada que entra aqui assina o Termo de Autorização em nome do CNPJ do
// cliente na SERPRO. Quem sobe assume, por escrito, que o titular autorizou.
import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { formatCnpj } from '@/lib/format/masks';
import { uploadCertificadoClienteAction } from './cert-actions';

export type CertInfo = {
  presente: boolean;
  validoAte: string | null;
  certCnpj: string | null;
  enviadoEm: string | null;
  /** Quem subiu: o dono da empresa, alguém do escritório, ou linha anterior à 0085. */
  origem: 'cliente' | 'escritorio' | 'desconhecido';
};

const DIA_MS = 86_400_000;

export default function CertificadoCliente({ companyId, cert }: { companyId: string; cert: CertInfo }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false); // latch síncrono contra duplo-envio
  const [senha, setSenha] = useState('');
  const [autorizado, setAutorizado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dias = cert.validoAte
    ? Math.floor((new Date(cert.validoAte).getTime() - Date.now()) / DIA_MS)
    : null;

  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('companyId', companyId);
      fd.set('file', file);
      fd.set('senha', senha);
      fd.set('autorizacao', autorizado ? 'on' : '');
      const r = await uploadCertificadoClienteAction(fd);
      if (!r.ok) { toast('error', r.error); return; }
      if (r.warning) toast('warning', r.warning);
      else toast('success', 'Certificado enviado.');
      setSenha('');
      setAutorizado(false);
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
    if (!autorizado) { toast('warning', 'Confirme que o titular autorizou a guarda do certificado.'); return; }
    if (cert.presente) setConfirmOpen(true); // substituição → confirma antes
    else void doUpload();
  }

  return (
    <>
      <section className="max-w-2xl">
        <div
          className={`mb-6 flex items-start gap-3 rounded-lg border p-4 text-sm ${
            !cert.presente || (dias != null && dias < 0)
              ? 'border-destructive/40 bg-destructive/10'
              : dias != null && dias < 30
                ? 'border-alert/40 bg-alert/10'
                : 'border-border bg-surface-2'
          }`}
        >
          {cert.presente && (dias == null || dias >= 30)
            ? <ShieldCheck className="size-5 shrink-0 text-success" />
            : <ShieldAlert className="size-5 shrink-0 text-alert" />}
          <div className="space-y-1 text-muted-foreground-2">
            {cert.presente ? (
              <>
                <p>
                  {cert.validoAte
                    ? dias != null && dias < 0
                      ? `Certificado VENCIDO em ${new Date(cert.validoAte).toLocaleDateString('pt-BR')}. A emissão de notas e a geração de DAS param até a troca.`
                      : `Certificado válido até ${new Date(cert.validoAte).toLocaleDateString('pt-BR')}${dias != null ? ` (${dias} dia${dias === 1 ? '' : 's'})` : ''}.`
                    : 'Certificado enviado (validade não detectada).'}
                </p>
                <p className="text-xs">
                  {cert.certCnpj ? `CNPJ do certificado: ${formatCnpj(cert.certCnpj)}. ` : ''}
                  {cert.origem === 'escritorio'
                    ? 'Enviado pelo escritório'
                    : cert.origem === 'cliente'
                      ? 'Enviado pelo próprio cliente'
                      : 'Origem não registrada (envio anterior ao registro de quem enviou)'}
                  {cert.enviadoEm ? ` em ${new Date(cert.enviadoEm).toLocaleString('pt-BR')}.` : '.'}
                </p>
              </>
            ) : (
              <p>
                Nenhum certificado A1 para este cliente. Sem ele não há Termo de Autorização na
                SERPRO — e sem Termo não sai DAS nem consulta de declaração.
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground-2">Arquivo do certificado (.pfx / .p12)</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pfx,.p12"
              className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm"
            />
            <span className="text-[11px] text-muted-foreground">
              O arquivo precisa ser o e-CNPJ deste cliente: o envio é recusado se o CNPJ do
              certificado não bater com o da empresa.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground-2">Senha do certificado</span>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="off"
              className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">
              A senha é usada só para abrir o arquivo e não fica guardada.
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <input
              type="checkbox"
              checked={autorizado}
              onChange={(e) => setAutorizado(e.target.checked)}
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="text-muted-foreground-2">
              Declaro que o titular autorizou o escritório a enviar e manter em guarda o
              certificado digital da empresa. O envio fica registrado com meu nome e a data, e o
              cliente vê esse registro na conta dele.
            </span>
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {cert.presente ? 'Substituir certificado' : 'Enviar certificado'}
            </button>
          </div>
        </form>
      </section>

      <PopupConfirm
        open={confirmOpen}
        variant="destructive"
        title="Substituir o certificado deste cliente?"
        description="A troca afeta a emissão de notas e a autorização na SERPRO deste cliente. Confirme que o arquivo é o e-CNPJ da empresa certa e que a senha está correta."
        confirmLabel="Substituir certificado"
        cancelLabel="Cancelar"
        busy={busy}
        onConfirm={doUpload}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
