'use client';
// Popup de adição de empresa para contadores.
// Estado 'select': 2 cards (existente ou abertura).
// Estado 'existing': abre CreateCompanyDialog inline.
// Estado 'abertura': exibe AberturaWizard dentro do modal.
import { useState } from 'react';
import { Building2, FilePlus, X } from 'lucide-react';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
import AberturaWizard from '@/components/abertura/AberturaWizard';
import { submitAberturaAction } from '@/app/(onboarding)/onboarding/abertura/actions';

type View = 'select' | 'existing' | 'abertura';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
};

export default function AddEmpresaDialog({ open, onClose, onCreated }: Props) {
  const [view, setView] = useState<View>('select');

  function handleClose() {
    setView('select');
    onClose();
  }

  if (!open) return null;

  // CreateCompanyDialog é um <dialog> nativo — gerencia sua própria sobreposição.
  if (view === 'existing') {
    return (
      <CreateCompanyDialog
        open
        onClose={handleClose}
        onCreated={(id) => { handleClose(); onCreated?.(id); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className={`bg-surface border border-border rounded-2xl flex flex-col w-full ${
        view === 'abertura' ? 'max-w-2xl max-h-[90vh]' : 'max-w-md'
      }`}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
          <h2 className="font-semibold text-foreground">
            {view === 'select' ? 'Adicionar empresa' : 'Solicitar abertura de empresa'}
          </h2>
          <button type="button" onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Conteúdo com scroll quando necessário */}
        <div className="overflow-y-auto px-6 pb-6">
          {view === 'select' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setView('existing')}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left hover:border-primary transition"
              >
                <Building2 className="size-5 text-primary" />
                <span className="text-sm font-medium text-foreground">Já tenho uma empresa</span>
                <span className="text-xs text-muted-foreground">Tenho CNPJ ativo e quero conectá-la.</span>
              </button>

              <button
                type="button"
                onClick={() => setView('abertura')}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left hover:border-primary transition"
              >
                <FilePlus className="size-5 text-primary" />
                <span className="text-sm font-medium text-foreground">Quero abrir uma empresa</span>
                <span className="text-xs text-muted-foreground">Ainda não tenho CNPJ. Solicitar abertura.</span>
              </button>
            </div>
          )}

          {view === 'abertura' && (
            <AberturaWizard
              mode="criar"
              action={submitAberturaAction}
              onBack={() => setView('select')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
