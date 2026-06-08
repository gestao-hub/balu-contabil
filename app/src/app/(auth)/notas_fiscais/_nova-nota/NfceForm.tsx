'use client';
// @custom — Emissão multi-tipo: form NFC-e (modelo 65). Consumidor final.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import ItensField, { type LinhaItem } from './ItensField';
import { emitirNfceAction, type ProdutoOption } from '../actions';

const FORMAS = [
  { v: '01', label: 'Dinheiro' },
  { v: '03', label: 'Cartão de crédito' },
  { v: '04', label: 'Cartão de débito' },
  { v: '17', label: 'PIX' },
];

export default function NfceForm({ produtos, onSuccess }: { produtos: ProdutoOption[]; onSuccess: () => void }) {
  const [itens, setItens] = useState<LinhaItem[]>([]);
  const [formaPgto, setFormaPgto] = useState('01');
  const [cpf, setCpf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const total = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);

  async function emitir() {
    setErro(null);
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    try {
      const r = await emitirNfceAction({
        itens: itens.map(({ _key, ...rest }) => rest),
        pagamentos: [{ forma: formaPgto, valor: Math.round(total * 100) / 100 }],
        consumidorCpf: cpf.replace(/\D+/g, '') || null,
      });
      if (!r.ok) { setErro(r.error); return; }
      onSuccess();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <ItensField produtosIniciais={produtos} tipoNf="nfce" itens={itens} onChange={setItens} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="forma-pgto" className="block text-sm font-medium text-muted-foreground-2 mb-1">Forma de pagamento</label>
          <select id="forma-pgto" value={formaPgto} onChange={(e) => setFormaPgto(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            {FORMAS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cpf-consumidor" className="block text-sm font-medium text-muted-foreground-2 mb-1">CPF do consumidor (opcional)</label>
          <input id="cpf-consumidor" value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))}
            placeholder="Somente números" className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Total: <strong>R$ {total.toFixed(2)}</strong></p>
      {erro && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{erro}</p>}
      <button type="button" onClick={emitir} disabled={enviando}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {enviando && <Loader2 className="size-4 animate-spin" />}{enviando ? 'Emitindo…' : 'Emitir NFC-e'}
      </button>
    </div>
  );
}
