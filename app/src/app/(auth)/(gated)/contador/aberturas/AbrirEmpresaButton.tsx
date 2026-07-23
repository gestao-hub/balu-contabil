'use client';
// @custom — Botão "Abrir empresa" da fila: abre o AberturaWizard num modal.
// Usa a action do escritório (criarAberturaClienteAction): a abertura nasce na
// carteira, sem dono, sem mexer no current_company do contador. Em sucesso a
// action redireciona pra /contador/aberturas (a nova solicitação aparece na lista).
import { useState } from 'react';
import { FilePlus, X } from 'lucide-react';
import AberturaWizard from '@/components/abertura/AberturaWizard';
import { criarAberturaClienteAction } from '@/app/(auth)/(gated)/contador/actions';

export default function AbrirEmpresaButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <FilePlus className="size-4" /> Abrir empresa
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface">
            <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-5">
              <h2 className="font-semibold text-foreground">Solicitar abertura de empresa</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 pb-6">
              <AberturaWizard
                mode="criar"
                action={criarAberturaClienteAction}
                onBack={() => setOpen(false)}
                naked
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
