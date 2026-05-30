'use client';
// @custom — Emissão multi-tipo: editor de itens compartilhado por NF-e e NFC-e.
// Itens vêm de aux_produtos (dropdown) ou são criados inline (criarProdutoAction).
// [×] remove o item DA NOTA (não exclui o produto).
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { criarProdutoAction, type ProdutoOption } from '../../actions';
import type { NfeItem } from '@/lib/fiscal/nfe-payload';

export type LinhaItem = NfeItem & { _key: string };

export default function ItensField({
  produtosIniciais,
  tipoNf,
  itens,
  onChange,
}: {
  produtosIniciais: ProdutoOption[];
  tipoNf: 'nfe' | 'nfce';
  itens: LinhaItem[];
  onChange: (itens: LinhaItem[]) => void;
}) {
  const [produtos, setProdutos] = useState<ProdutoOption[]>(produtosIniciais);
  const [selecao, setSelecao] = useState<string>('');
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [d, setD] = useState(''); const [ncm, setNcm] = useState(''); const [cfop, setCfop] = useState('');
  const [un, setUn] = useState('UN'); const [vlr, setVlr] = useState('');

  function addDoDropdown() {
    const p = produtos.find((x) => x.id === selecao);
    if (!p) return;
    onChange([...itens, {
      _key: `${p.id}-${itens.length}-${Date.now()}`,
      descricao: p.descricao,
      ncm: p.ncm ?? '',
      cfop: p.cfop ?? '',
      unidade: p.unidade ?? 'UN',
      quantidade: 1,
      valorUnitario: p.valorUnitario ?? 0,
    }]);
    setSelecao('');
  }

  async function criarEAdicionar() {
    setErro(null); setSalvando(true);
    const r = await criarProdutoAction({
      descricao: d, ncm, cfop, unidade: un,
      valorUnitario: Number(vlr.replace(',', '.')), tipoNf,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    setProdutos([...produtos, r.produto]);
    onChange([...itens, {
      _key: `${r.produto.id}-${itens.length}-${Date.now()}`,
      descricao: r.produto.descricao, ncm: r.produto.ncm ?? '', cfop: r.produto.cfop ?? '',
      unidade: r.produto.unidade ?? 'UN', quantidade: 1, valorUnitario: r.produto.valorUnitario ?? 0,
    }]);
    setNovo(false); setD(''); setNcm(''); setCfop(''); setUn('UN'); setVlr('');
  }

  function removerLinha(key: string) {
    onChange(itens.filter((i) => i._key !== key));
  }
  function setQtdLinha(key: string, q: number) {
    onChange(itens.map((i) => (i._key === key ? { ...i, quantidade: q } : i)));
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-muted-foreground-2">Itens da nota</label>

      <div className="flex gap-2">
        <select
          value={selecao}
          onChange={(e) => setSelecao(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Buscar produto…</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>{p.descricao}{p.ncm ? ` · NCM ${p.ncm}` : ''}</option>
          ))}
        </select>
        <button type="button" onClick={addDoDropdown} disabled={!selecao}
          className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">Adicionar</button>
        <button type="button" onClick={() => setNovo(!novo)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm">
          <Plus className="size-4" /> Novo
        </button>
      </div>

      {novo && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 bg-surface-2">
          <input placeholder="Descrição" value={d} onChange={(e) => setD(e.target.value)} className="col-span-2 rounded border border-border bg-surface px-2 py-1 text-sm" />
          <input placeholder="NCM (8 díg)" value={ncm} onChange={(e) => setNcm(e.target.value.replace(/\D+/g, '').slice(0, 8))} className="rounded border border-border bg-surface px-2 py-1 text-sm font-mono" />
          <input placeholder="CFOP (4 díg)" value={cfop} onChange={(e) => setCfop(e.target.value.replace(/\D+/g, '').slice(0, 4))} className="rounded border border-border bg-surface px-2 py-1 text-sm font-mono" />
          <input placeholder="Unidade" value={un} onChange={(e) => setUn(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm" />
          <input placeholder="Valor unit. (R$)" value={vlr} onChange={(e) => setVlr(e.target.value.replace(/[^\d.,]/g, ''))} className="rounded border border-border bg-surface px-2 py-1 text-sm" />
          <button type="button" onClick={criarEAdicionar} disabled={salvando} className="col-span-2 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Criar e adicionar'}
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item adicionado.</p>
      ) : (
        <ul className="space-y-1">
          {itens.map((it) => (
            <li key={it._key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex-1">{it.descricao} <span className="text-muted-foreground">· NCM {it.ncm} · CFOP {it.cfop}</span></span>
              <input type="number" min={1} value={it.quantidade}
                onChange={(e) => setQtdLinha(it._key, Math.max(1, Number(e.target.value)))}
                className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-sm" />
              <span className="w-24 text-right">R$ {(it.quantidade * it.valorUnitario).toFixed(2)}</span>
              <button type="button" onClick={() => removerLinha(it._key)} className="text-destructive" aria-label="Remover item">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
