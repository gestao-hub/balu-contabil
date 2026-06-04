'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

// Volta na história do navegador para preservar os filtros (que vivem na URL da
// listagem). Fallback para a listagem caso não haja histórico (acesso direto).
export default function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/notas_fiscais');
      }}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
    >
      <ArrowLeft className="size-4" />
      Voltar
    </button>
  );
}
