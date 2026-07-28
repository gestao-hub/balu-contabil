'use client';
// Pix copia e cola de UMA cobrança do escritório. Só é montado quando o campo
// veio preenchido do banco — ver o comentário em page.tsx sobre `pix_copia_cola`
// ainda não ter escritor.
//
// Client Component: `navigator.clipboard` não existe no servidor. Recebe APENAS
// o payload — nada de id de cobrança, de escritório ou do Asaas atravessa para
// o browser por aqui.
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function CopiarPix({ payload }: { payload: string }) {
  const [estado, setEstado] = useState<'parado' | 'copiado' | 'erro'>('parado');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(payload);
      setEstado('copiado');
      setTimeout(() => setEstado('parado'), 2000);
    } catch {
      // Clipboard bloqueada (http, permissão negada, navegador antigo): revela
      // o código para o cliente selecionar à mão em vez de sumir em silêncio.
      setEstado('erro');
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={copiar}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground-2 transition-colors hover:border-primary hover:text-primary"
      >
        {estado === 'copiado' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {estado === 'copiado' ? 'Código Pix copiado' : 'Copiar código Pix'}
      </button>
      {estado === 'erro' && (
        <p className="mt-1.5 break-all rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-muted-foreground">
          Não foi possível copiar automaticamente. Selecione e copie o código:
          <br />
          <span className="text-foreground">{payload}</span>
        </p>
      )}
    </div>
  );
}
