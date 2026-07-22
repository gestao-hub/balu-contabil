'use client';
// src/app/(auth)/configuracoes/MeuEscritorioCard.tsx
// Task 18 — LGPD art. 18: bloco "Meu escritório" na aba Dados da empresa. Só
// aparece quando a empresa tem contabilidade_id; some inteiramente caso contrário.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Unlink } from 'lucide-react';
import PopupConfirm from '@/components/PopupConfirm';
import { useToast } from '@/components/Toaster';
import { desvincularEscritorioAction } from './actions';

type Props = {
  companyId: string;
  nomeEscritorio: string;
};

export default function MeuEscritorioCard({ companyId, nomeEscritorio }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const r = await desvincularEscritorioAction(companyId);
      setConfirmando(false);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Escritório desvinculado.');
      router.refresh();
    });
  }

  return (
    <section className="mt-6 max-w-3xl rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Building2 className="size-4 text-primary" />
        Meu escritório
      </h2>
      <p className="text-sm text-muted-foreground">
        Sua empresa está vinculada ao escritório <strong className="text-foreground">{nomeEscritorio}</strong>.
        Ele pode visualizar suas notas, impostos e guias — ele não pode emitir nem alterar nada.
      </p>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
      >
        <Unlink className="size-3.5" />
        Desvincular escritório
      </button>

      <PopupConfirm
        open={confirmando}
        title="Desvincular escritório"
        description="O escritório deixará de ver seus dados imediatamente. Nada é apagado."
        confirmLabel="Desvincular"
        cancelLabel="Cancelar"
        variant="destructive"
        busy={pending}
        onConfirm={confirmar}
        onCancel={() => setConfirmando(false)}
      />
    </section>
  );
}
