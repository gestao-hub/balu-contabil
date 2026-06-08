'use client';
// @custom — Emissão multi-tipo: form NF-e (modelo 55). Client component.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import ItensField, { type LinhaItem } from './ItensField';
import { emitirNfeAction, type ProdutoOption } from '../actions';

export default function NfeForm({ clientes, produtos }: { clientes: ClienteOption[]; produtos: ProdutoOption[] }) {
  const router = useRouter();
  const [clienteId, setClienteId] = useState('');
  const [natureza, setNatureza] = useState('Venda de mercadoria');
  const [itens, setItens] = useState<LinhaItem[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function emitir() {
    setErro(null);
    if (!clienteId) { setErro('Selecione um cliente.'); return; }
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    try {
      const r = await emitirNfeAction({
        clienteId,
        naturezaOperacao: natureza,
        itens: itens.map(({ _key, ...rest }) => rest),
      });
      if (!r.ok) { setErro(r.error); return; }
      router.push('/notas_fiscais');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Cliente (destinatário)</label>
        <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
      </div>
      <div>
        <label htmlFor="natureza" className="block text-sm font-medium text-muted-foreground-2 mb-1">Natureza da operação</label>
        <input id="natureza" value={natureza} onChange={(e) => setNatureza(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <ItensField produtosIniciais={produtos} tipoNf="nfe" itens={itens} onChange={setItens} />
      {erro && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{erro}</p>}
      <button type="button" onClick={emitir} disabled={enviando}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {enviando && <Loader2 className="size-4 animate-spin" />}{enviando ? 'Emitindo…' : 'Emitir NF-e'}
      </button>
    </div>
  );
}
