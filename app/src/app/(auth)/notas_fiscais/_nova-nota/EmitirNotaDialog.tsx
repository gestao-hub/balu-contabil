'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, FileText, Package, ShoppingCart, Loader2 } from 'lucide-react';
import {
  listarTiposEmissaoAction,
  prepararEmissaoAction,
  type TiposHabilitados,
  type PreparoEmissao,
  type Bloqueio,
} from '../actions';
import EmissaoForm from './EmissaoForm';
import NfeForm from './NfeForm';
import NfceForm from './NfceForm';

type Tipo = 'nfse' | 'nfe' | 'nfce';
type PreparoOk = Extract<PreparoEmissao, { ok: true }>;

const CARDS: { key: Tipo; titulo: string; sub: string; Icon: typeof FileText }[] = [
  { key: 'nfse', titulo: 'NFS-e', sub: 'Serviço', Icon: FileText },
  { key: 'nfe', titulo: 'NF-e', sub: 'Produto (modelo 55)', Icon: Package },
  { key: 'nfce', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', Icon: ShoppingCart },
];

export default function EmitirNotaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [tipos, setTipos] = useState<TiposHabilitados | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [preparo, setPreparo] = useState<PreparoOk | null>(null);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Ao abrir: reseta e carrega os tipos habilitados; se só 1, pula pro form.
  useEffect(() => {
    if (!open) return;
    setTipo(null); setPreparo(null); setBloqueio(null); setTipos(null);
    setCarregando(true);
    listarTiposEmissaoAction().then((t) => {
      setTipos(t);
      const habilitados = (['nfse', 'nfe', 'nfce'] as Tipo[]).filter((k) => t[k]);
      if (habilitados.length === 1) {
        void escolher(habilitados[0]!);
      } else {
        setCarregando(false);
      }
    });
    // escolher não muda entre renders; só depende de `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function escolher(t: Tipo) {
    setTipo(t); setBloqueio(null); setPreparo(null); setCarregando(true);
    const r = await prepararEmissaoAction(t);
    if (r.ok) setPreparo(r);
    else setBloqueio(r.bloqueio);
    setCarregando(false);
  }

  function voltar() { setTipo(null); setPreparo(null); setBloqueio(null); }
  function sucesso() { onClose(); router.refresh(); }

  if (!open) return null;

  const titulo = !tipo ? 'Emitir nota fiscal'
    : tipo === 'nfse' ? 'Emitir NFS-e'
    : tipo === 'nfe' ? 'Emitir NF-e'
    : 'Emitir NFC-e';

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => { e.preventDefault(); if (!carregando) onClose(); }}
      className="rounded-xl border border-border bg-surface text-foreground p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-2">
            {tipo && !carregando && (
              <button type="button" onClick={voltar} aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>

        <div className="px-6 py-5">
          {carregando && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {!carregando && !tipo && tipos && (
            <>
              <p className="text-sm text-muted-foreground mb-4">Escolha o tipo de documento.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CARDS.map(({ key, titulo: t, sub, Icon }) => tipos[key] ? (
                  <button key={key} type="button" onClick={() => escolher(key)}
                    className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2 text-left">
                    <span className="text-primary"><Icon className="size-6" /></span>
                    <span className="font-medium text-foreground">{t}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
                ) : (
                  <div key={key} aria-disabled
                    className="rounded-xl border border-border bg-surface p-5 opacity-50 cursor-not-allowed flex flex-col gap-2"
                    title="Empresa não habilitada para este tipo">
                    <span className="text-muted-foreground"><Icon className="size-6" /></span>
                    <span className="font-medium text-muted-foreground">{t}</span>
                    <span className="text-xs text-muted-foreground">{sub} · não habilitado</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!carregando && bloqueio && (
            <div className="rounded-lg border border-alert/30 bg-alert/5 p-5">
              <h3 className="text-base font-semibold text-alert">{bloqueio.titulo}</h3>
              <p className="text-sm text-muted-foreground-2 mt-2">{bloqueio.mensagem}</p>
              {bloqueio.href && bloqueio.labelLink && (
                <a href={bloqueio.href} className="inline-block mt-4 text-sm font-medium text-primary hover:underline">{bloqueio.labelLink} →</a>
              )}
              <button type="button" onClick={voltar} className="mt-3 ml-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" /> Voltar
              </button>
            </div>
          )}

          {!carregando && preparo?.tipo === 'nfse' && (
            <EmissaoForm clientes={preparo.dados.clientes} previewImposto={preparo.dados.previewImposto} cnaes={preparo.dados.cnaes} onSuccess={sucesso} />
          )}
          {!carregando && preparo?.tipo === 'nfe' && (
            <NfeForm clientes={preparo.dados.clientes} produtos={preparo.dados.produtos} onSuccess={sucesso} />
          )}
          {!carregando && preparo?.tipo === 'nfce' && (
            <NfceForm produtos={preparo.dados.produtos} onSuccess={sucesso} />
          )}
        </div>
      </div>
    </dialog>
  );
}
