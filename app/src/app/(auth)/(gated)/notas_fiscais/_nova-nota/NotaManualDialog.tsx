'use client';
// @custom — Modal de lançamento manual de NF (escolhe tipo → form do tipo). Sem Focus.
// Reusa os MESMOS forms da emissão (EmissaoForm/NfeForm/NfceForm) em modo='manual'.
//
// SEM a trava de habilitação da emissão, e isso é o ponto do modal.
//
// Até 12/08/2026 ele chamava `listarTiposEmissaoAction()` e só deixava clicável
// o que a Focus tivesse habilitado (`focus_habilita_*`). O efeito era o avesso do
// propósito: quem emite pelo portal da prefeitura — o caso que faz o lançamento
// manual existir — via os três tipos apagados e não conseguia registrar nada,
// porque não estava habilitado a emitir PELA PLATAFORMA. Empresa sem certificado
// ficava sem nenhum caminho para ter suas notas no app.
//
// Registrar uma nota que já existe não emite nada na Receita, e a action do
// servidor (`prepararNotaManualAction`) já era escrita sem guard nenhum. O modal
// é que discordava do servidor.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, FileText, Package, ShoppingCart, Loader2 } from 'lucide-react';
import { prepararNotaManualAction, type PreparoNotaManual } from '../actions';
import EmissaoForm from './EmissaoForm';
import NfeForm from './NfeForm';
import NfceForm from './NfceForm';

type Tipo = 'NFSe' | 'NFe' | 'NFCe';
const CARDS: { key: Tipo; titulo: string; sub: string; Icon: typeof FileText }[] = [
  { key: 'NFSe', titulo: 'NFS-e', sub: 'Serviço', Icon: FileText },
  { key: 'NFe', titulo: 'NF-e', sub: 'Produto (modelo 55)', Icon: Package },
  { key: 'NFCe', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', Icon: ShoppingCart },
];
const LABEL: Record<Tipo, string> = { NFSe: 'NFS-e', NFe: 'NF-e', NFCe: 'NFC-e' };

export default function NotaManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [preparo, setPreparo] = useState<PreparoNotaManual | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Ao abrir: volta para a escolha do tipo. Nada a carregar — os três tipos
  // sempre podem ser registrados.
  useEffect(() => {
    if (!open) return;
    setTipo(null);
    setPreparo(null);
    setCarregando(false);
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
          {carregando ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : !tipo ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">Escolha o tipo de documento.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CARDS.map(({ key, titulo, sub, Icon }) => (
                  <button key={key} type="button" onClick={() => escolher(key)}
                    className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2 text-left">
                    <span className="text-primary"><Icon className="size-6" /></span>
                    <span className="font-medium text-foreground">{titulo}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
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
