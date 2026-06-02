'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import AberturaWizard from '@/components/abertura/AberturaWizard';
import { loadAberturaAtual, solicitarAlteracaoDialogAction } from '@/app/(onboarding)/onboarding/abertura/actions';
import type { AberturaData, DocKey } from '@/types/abertura';

type Props = { open: boolean; onClose: () => void };

export default function AlteracaoDialog({ open, onClose }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<{
    data: AberturaData;
    docs: Partial<Record<DocKey, string>>;
  } | null>(null);

  useEffect(() => {
    if (!open) { setDados(null); setErro(null); return; }
    setLoading(true);
    loadAberturaAtual()
      .then(res => {
        if (!res) { setErro('Solicitação de abertura não encontrada.'); }
        else { setDados({ data: res.data, docs: res.docs }); }
      })
      .catch(() => setErro('Erro ao carregar dados da abertura.'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleAction(fd: FormData) {
    const res = await solicitarAlteracaoDialogAction(fd);
    if (res.ok) {
      router.refresh();
      onClose();
    }
    return res;
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 px-4 py-8 overflow-y-auto">
      <div className="relative w-full max-w-2xl my-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 grid size-8 place-items-center rounded-full bg-surface border border-border text-muted-foreground hover:text-foreground shadow-sm"
          title="Fechar"
        >
          <X className="size-4" />
        </button>

        {loading && (
          <div className="flex items-center justify-center bg-surface rounded-2xl border border-border p-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && erro && (
          <div className="bg-surface rounded-2xl border border-border p-8 text-center text-sm text-destructive">
            {erro}
          </div>
        )}

        {!loading && dados && (
          <AberturaWizard
            mode="alterar"
            initial={dados.data}
            existingDocs={dados.docs}
            action={handleAction}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
