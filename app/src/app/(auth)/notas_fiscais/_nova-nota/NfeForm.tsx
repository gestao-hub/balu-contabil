'use client';
// @custom — Form NF-e (modelo 55). Serve emissão real (emitirNfeAction) e
// lançamento manual (lancarNotaManualAction) via prop `modo`.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import ItensField, { type LinhaItem } from './ItensField';
import { emitirNfeAction, lancarNotaManualAction, type ProdutoOption } from '../actions';

const hojeBrt = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export default function NfeForm({
  clientes,
  produtos,
  onSuccess,
  modo = 'emissao',
}: {
  clientes: ClienteOption[];
  produtos: ProdutoOption[];
  onSuccess: () => void;
  modo?: 'emissao' | 'manual';
}) {
  const manual = modo === 'manual';
  const [clienteId, setClienteId] = useState('');
  const [natureza, setNatureza] = useState('Venda de mercadoria');
  const [itens, setItens] = useState<LinhaItem[]>([]);
  const [numero, setNumero] = useState('');
  const [dataEmissao, setDataEmissao] = useState<string>(hojeBrt);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submit() {
    setErro(null);
    if (!clienteId) { setErro('Selecione um cliente.'); return; }
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    try {
      const itensLimpos = itens.map(({ _key, ...rest }) => rest);
      const r = manual
        ? await lancarNotaManualAction({ tipo: 'NFe', clienteId, numero: numero.trim(), dataEmissao, naturezaOperacao: natureza, itens: itensLimpos })
        : await emitirNfeAction({ clienteId, naturezaOperacao: natureza, itens: itensLimpos });
      if (!r.ok) { setErro(r.error); return; }
      onSuccess();
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

      {manual && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="nfe-numero" className="block text-sm font-medium text-muted-foreground-2 mb-1">Número da nota</label>
            <input id="nfe-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 1234"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label htmlFor="nfe-data" className="block text-sm font-medium text-muted-foreground-2 mb-1">Data de emissão</label>
            <input id="nfe-data" type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="natureza" className="block text-sm font-medium text-muted-foreground-2 mb-1">Natureza da operação</label>
        <input id="natureza" value={natureza} onChange={(e) => setNatureza(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>
      <ItensField produtosIniciais={produtos} tipoNf="nfe" itens={itens} onChange={setItens} />
      {erro && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{erro}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={enviando}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {enviando && <Loader2 className="size-4 animate-spin" />}
          {enviando ? (manual ? 'Lançando…' : 'Emitindo…') : (manual ? 'Lançar NF-e' : 'Emitir NF-e')}
        </button>
      </div>
    </div>
  );
}
