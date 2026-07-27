'use client';
import { useState, useTransition } from 'react';
import { salvarPlanoAction, desativarPlanoAction, type PlanoInput } from './actions';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanosAdmin({
  planos, usoPorPlano,
}: { planos: PlanoInput[]; usoPorPlano: Record<string, number> }) {
  const [edit, setEdit] = useState<PlanoInput | null>(null);
  // O valor em edicao vive como TEXTO. Um input controlado por
  // `(centavos/100).toFixed(2)` se reformata a cada tecla: digitar "59,90"
  // num campo mostrando "49.90" produzia 5.01, e o admin nao conseguia
  // escrever o preco digito a digito — numa tela cuja unica funcao e mudar
  // precos. A conversao acontece so no salvar.
  const [valorTexto, setValorTexto] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pending, start] = useTransition();

  function abrirEdicao(p: PlanoInput) {
    setEdit(p);
    setValorTexto((p.valor_centavos / 100).toFixed(2).replace('.', ','));
    setMsg(null);
  }

  /** Aceita "1.234,56" e "1234.56". Devolve null quando não é número. */
  function paraCentavos(txt: string): number | null {
    const limpo = txt.trim().replace(/\./g, '').replace(',', '.');
    if (!limpo || !/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
    return Math.round(parseFloat(limpo) * 100);
  }

  function salvar(p: PlanoInput) {
    const centavos = paraCentavos(valorTexto);
    if (centavos === null) {
      setMsg({ tipo: 'erro', texto: 'Valor inválido. Use por exemplo 199,00.' });
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await salvarPlanoAction({ ...p, valor_centavos: centavos });
      setMsg(r.ok ? { tipo: 'ok', texto: 'Salvo.' } : { tipo: 'erro', texto: r.error });
      if (r.ok) setEdit(null);
    });
  }

  function desativar(id: string) {
    setMsg(null);
    start(async () => {
      const r = await desativarPlanoAction(id);
      setMsg(r.ok
        ? { tipo: 'ok', texto: 'Plano desativado.' }
        : { tipo: 'erro', texto: r.error });
    });
  }

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`text-sm rounded border px-3 py-2 ${
          msg.tipo === 'ok'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}>
          {msg.texto}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2">Plano</th><th>Público</th><th>Valor</th>
              <th>Faixa</th><th>Teste</th><th>Em uso</th><th></th>
            </tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-2">
                  {p.nome}
                  {!p.ativo && <span className="ml-2 text-xs text-neutral-400">(inativo)</span>}
                </td>
                <td>{p.publico === 'empresa' ? 'Empresário' : 'Escritório'}</td>
                <td>{reais(p.valor_centavos)}</td>
                <td>
                  {p.publico === 'escritorio'
                    ? `${p.clientes_min ?? 0} a ${p.clientes_max ?? '∞'}`
                    : '—'}
                </td>
                <td>{p.trial_dias} dias</td>
                <td>{usoPorPlano[p.id] ?? 0}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="underline mr-3" onClick={() => abrirEdicao(p)}>Editar</button>
                  {p.ativo && (
                    <button className="underline" disabled={pending} onClick={() => desativar(p.id)}>
                      Desativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <form
          className="border rounded p-4 space-y-3 max-w-md"
          onSubmit={(e) => { e.preventDefault(); salvar(edit); }}
        >
          <h2 className="font-medium">Editar {edit.nome}</h2>

          <label className="block text-sm">Nome
            <input className="mt-1 w-full border rounded px-2 py-1" value={edit.nome}
              onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
          </label>

          <label className="block text-sm">Valor (R$)
            <input type="text" inputMode="decimal" className="mt-1 w-full border rounded px-2 py-1"
              value={valorTexto} placeholder="199,00"
              onChange={(e) => setValorTexto(e.target.value)} />
          </label>

          <label className="block text-sm">Dias de teste
            <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
              value={edit.trial_dias}
              onChange={(e) => setEdit({ ...edit, trial_dias: parseInt(e.target.value || '0', 10) })} />
            <span className="text-xs text-neutral-500">
              Vale para quem se cadastrar a partir de agora.
            </span>
          </label>

          {edit.publico === 'escritorio' && (
            <div className="flex gap-3">
              <label className="block text-sm flex-1">De (clientes)
                <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
                  value={edit.clientes_min ?? 0}
                  onChange={(e) => setEdit({
                    ...edit, clientes_min: parseInt(e.target.value || '0', 10),
                  })} />
              </label>
              <label className="block text-sm flex-1">Até (vazio = sem limite)
                <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
                  value={edit.clientes_max ?? ''}
                  onChange={(e) => setEdit({
                    ...edit,
                    clientes_max: e.target.value === '' ? null : parseInt(e.target.value, 10),
                  })} />
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="border rounded px-3 py-1">
              Salvar
            </button>
            <button type="button" onClick={() => setEdit(null)} className="underline px-3 py-1">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
