// src/app/(auth)/conta/ExportarDadosButton.tsx
'use client';
import { useTransition } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { exportarMeusDadosAction } from './actions';

export default function ExportarDadosButton() {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  function handleExportar() {
    startTransition(async () => {
      const r = await exportarMeusDadosAction();
      if (!r.ok) {
        toast('error', r.error);
        return;
      }
      const blob = new Blob([r.data.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meus-dados-balu.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('success', 'Seus dados foram exportados.');
    });
  }

  return (
    <div className="max-w-lg rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        Meus dados
      </p>
      <p className="text-xs text-muted-foreground-2 mb-4">
        Baixe uma cópia de todos os dados vinculados à sua conta (LGPD, art. 18). Credenciais e
        certificados nunca são incluídos.
      </p>
      <button
        type="button"
        onClick={handleExportar}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {isPending ? 'Gerando…' : 'Exportar meus dados'}
      </button>
    </div>
  );
}
