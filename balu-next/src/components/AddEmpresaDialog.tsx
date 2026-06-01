'use client';
// Popup de seleção: adicionar empresa existente ou solicitar abertura.
// Usado pelo MenuLateral quando o contador quer adicionar uma nova empresa.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FilePlus, X } from 'lucide-react';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
};

export default function AddEmpresaDialog({ open, onClose, onCreated }: Props) {
  const router = useRouter();
  const [showExisting, setShowExisting] = useState(false);

  if (!open) return null;

  if (showExisting) {
    return (
      <CreateCompanyDialog
        open
        onClose={() => { setShowExisting(false); onClose(); }}
        onCreated={(id) => { onClose(); onCreated?.(id); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-foreground">Adicionar empresa</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setShowExisting(true)}
            className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left hover:border-primary transition"
          >
            <Building2 className="size-5 text-primary" />
            <span className="text-sm font-medium text-foreground">Já tenho uma empresa</span>
            <span className="text-xs text-muted-foreground">Tenho CNPJ ativo e quero conectá-la.</span>
          </button>

          <button
            type="button"
            onClick={() => { onClose(); router.push('/onboarding/abertura'); }}
            className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left hover:border-primary transition"
          >
            <FilePlus className="size-5 text-primary" />
            <span className="text-sm font-medium text-foreground">Quero abrir uma empresa</span>
            <span className="text-xs text-muted-foreground">Ainda não tenho CNPJ. Solicitar abertura.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
