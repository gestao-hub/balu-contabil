'use client';
// @custom — Modal de lançamento manual de NF (escolhe tipo → form do tipo). Sem Focus.
// Reusa os MESMOS forms da emissão (EmissaoForm/NfeForm/NfceForm) em modo='manual'.
// Mesma trava de habilitação da emissão (listarTiposEmissaoAction): só os tipos
// que a empresa pode emitir ficam clicáveis.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, FileText, Package, ShoppingCart, Loader2 } from 'lucide-react';
import {
  listarTiposEmissaoAction,
  prepararNotaManualAction,
  type TiposHabilitados,
  type PreparoNotaManual,
} from '../actions';
import EmissaoForm from './EmissaoForm';
import NfeForm from './NfeForm';
import NfceForm from './NfceForm';

type Tipo = 'NFSe' | 'NFe' | 'NFCe';
const CARDS: { key: Tipo; flag: keyof TiposHabilitados; titulo: string; sub: string; Icon: typeof FileText }[] = [
  { key: 'NFSe', flag: 'nfse', titulo: 'NFS-e', sub: 'Serviço', Icon: FileText },
  { key: 'NFe', flag: 'nfe', titulo: 'NF-e', sub: 'Produto (modelo 55)', Icon: Package },
  { key: 'NFCe', flag: 'nfce', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', Icon: ShoppingCart },
];
const LABEL: Record<Tipo, string> = { NFSe: 'NFS-e', NFe: 'NF-e', NFCe: 'NFC-e' };

export default function NotaManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [tipos, setTipos] = useState<TiposHabilitados | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [preparo, setPreparo] = useState<PreparoNotaManual | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Ao abrir: reseta e carrega os tipos habilitados (mesma trava da emissão).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTipo(null);
    setPreparo(null);
    setTipos(null);
    setCarregando(false);
    listarTiposEmissaoAction().then((t) => { if (!cancelled) setTipos(t); });
    return () => { cancelled = true; };
  }, [open]);

  async function escolher(t: Tipo) {
    setTipo(t);
    setPreparo(null);
    setCarregando(true);
    const p = await prepararNotaManualAction(t);
    setPreparo(p);
    setCarregando(false);
  }

  function voltar() { setTipo(null); setPreparo(null); }
  function sucesso() { onClose(); router.refresh(); }

  if (!open) return null;

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
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Lançar nota manual{tipo ? ` · ${LABEL[tipo]}` : ''}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>

        <div className="px-6 py-5">
          {tipos === null || carregando ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : !tipo ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">Escolha o tipo de documento.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CARDS.map(({ key, flag, titulo, sub, Icon }) => tipos[flag] ? (
                  <button key={key} type="button" onClick={() => escolher(key)}
                    className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2 text-left">
                    <span className="text-primary"><Icon className="size-6" /></span>
                    <span className="font-medium text-foreground">{titulo}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
                ) : (
                  <div key={key} aria-disabled
                    className="rounded-xl border border-border bg-surface p-5 opacity-50 cursor-not-allowed flex flex-col gap-2"
                    title="Empresa não habilitada para este tipo">
                    <span className="text-muted-foreground"><Icon className="size-6" /></span>
                    <span className="font-medium text-muted-foreground">{titulo}</span>
                    <span className="text-xs text-muted-foreground">{sub} · não habilitado</span>
                  </div>
                ))}
              </div>
            </>
          ) : preparo?.tipo === 'NFSe' ? (
            <EmissaoForm modo="manual" clientes={preparo.clientes} cnaes={preparo.cnaes} onSuccess={sucesso} />
          ) : preparo?.tipo === 'NFe' ? (
            <NfeForm modo="manual" clientes={preparo.clientes} produtos={preparo.produtos} onSuccess={sucesso} />
          ) : preparo?.tipo === 'NFCe' ? (
            <NfceForm modo="manual" produtos={preparo.produtos} onSuccess={sucesso} />
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
