'use client';

import { useRouter } from 'next/navigation';

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
      className="text-sm text-primary hover:underline"
    >
      ← Voltar
    </button>
  );
}
