'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import { lancarNotaManualAction, type NotaManualItem } from '../actions';
import { brl } from '@/lib/fiscal/guia';

type LinhaItem = NotaManualItem & { _key: string };
const TIPOS = [
  { v: 'NFSe', label: 'NFS-e (serviço)' },
  { v: 'NFe', label: 'NF-e (produto)' },
  { v: 'NFCe', label: 'NFC-e (consumidor)' },
] as const;

export default function NotaManualForm({ clientes }: { clientes: ClienteOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [tipo, setTipo] = useState<'NFSe' | 'NFe' | 'NFCe'>('NFSe');
  const [clienteId, setClienteId] = useState('');
  const [numero, setNumero] = useState('');
  const [dataEmissao, setDataEmissao] = useState(() => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10));
  const [itens, setItens] = useState<LinhaItem[]>([{ _key: 'k0', descricao: '', valor: 0 }]);

  const total = useMemo(() => itens.reduce((s, i) => s + (Number.isFinite(i.valor) ? i.valor : 0), 0), [itens]);

  function setItem(key: string, patch: Partial<NotaManualItem>) {
    setItens((arr) => arr.map((i) => (i._key === key ? { ...i, ...patch } : i)));
  }
  function addItem() {
    setItens((arr) => [...arr, { _key: `k${Date.now()}`, descricao: '', valor: 0 }]);
  }
  function removeItem(key: string) {
    setItens((arr) => (arr.length > 1 ? arr.filter((i) => i._key !== key) : arr));
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const r = await lancarNotaManualAction({
        tipo,
        clienteId: clienteId || null,
        numero: numero.trim(),
        dataEmissao,
        itens: itens.map(({ descricao, valor }) => ({ descricao: descricao.trim(), valor })),
      });
      if (r.ok) {
        toast('success', 'Nota lançada.');
        router.push('/notas_fiscais');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </Campo>
        <Campo label="Cliente">
          <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
        </Campo>
        <Campo label="Número da nota">
          <input value={numero} onChange={(e) => setNumero(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Ex.: 1234" />
        </Campo>
        <Campo label="Data de emissão">
          <input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </Campo>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Itens</span>
          <button type="button" onClick={addItem}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <Plus className="size-4" /> Adicionar item
          </button>
        </div>
        <div className="space-y-2">
          {itens.map((i) => (
            <div key={i._key} className="flex items-center gap-2">
              <input value={i.descricao} onChange={(e) => setItem(i._key, { descricao: e.target.value })}
                placeholder="Descrição" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <input type="number" step="0.01" min="0" value={i.valor || ''}
                onChange={(e) => setItem(i._key, { valor: Number(e.target.value) })}
                placeholder="0,00" className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular-nums" />
              <button type="button" onClick={() => removeItem(i._key)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-right text-sm text-muted-foreground">Total: <strong className="text-foreground tabular-nums">{brl(total)}</strong></p>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? 'Lançando…' : 'Lançar nota'}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
