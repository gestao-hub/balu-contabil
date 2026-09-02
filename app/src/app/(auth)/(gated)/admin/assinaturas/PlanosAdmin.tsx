'use client';
import { useState, useTransition } from 'react';
import { CreditCard, Users, Pencil, Power } from 'lucide-react';
import { salvarPlanoAction, desativarPlanoAction, type PlanoInput } from './actions';
import { normalizarValorBRL } from '@/lib/format/dinheiro';

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

  /**
   * Aceita "1.234,56" e "1234.56". Devolve null quando não é número.
   *
   * ⚠️ O comentário acima já esteve mentindo. A implementação anterior apagava
   * TODOS os pontos antes de trocar a vírgula, então "1234.56" virava "123456"
   * e o preço do plano era gravado como R$ 123.456,00 — cem vezes o digitado.
   * `normalizarValorBRL` distingue milhar de decimal pelo número de casas.
   */
  function paraCentavos(txt: string): number | null {
    const limpo = normalizarValorBRL(txt);
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
      // O 'Salvo.' fixo engolia o aviso do excedente (achado ao revisar a
      // propria implementacao, 02/09/2026). Quando o plano tem mais assinaturas
      // que o lote imediato, parte do reajuste fica para a conferencia diaria —
      // e o admin PRECISA saber disso, senao sai daqui achando que 100% ja
      // mudou. Devolver o aviso e nao mostra-lo e o mesmo que nao te-lo.
      const aviso = r.ok ? (r.data as { aviso?: string } | undefined)?.aviso : undefined;
      setMsg(
        r.ok
          ? { tipo: 'ok', texto: aviso ? `Salvo. ${aviso}` : 'Salvo.' }
          : { tipo: 'erro', texto: r.error },
      );
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

  const campo =
    'mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-foreground';

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${
          msg.tipo === 'ok'
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-alert/40 bg-alert/10 text-alert'
        }`}>
          {msg.texto}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {planos.map((p) => {
          const emUso = usoPorPlano[p.id] ?? 0;
          return (
            <article
              key={p.id}
              className={`flex flex-col gap-3 rounded-md border bg-surface p-4 transition-colors ${
                p.ativo ? 'border-border hover:border-primary' : 'border-border/50 opacity-60'
              }`}
            >
              <header className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm leading-tight text-foreground">
                    <CreditCard className="size-4 shrink-0 text-primary" />
                    {p.nome}
                  </h3>
                  {!p.ativo && (
                    <span className="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-muted-foreground">
                      Inativo
                    </span>
                  )}
                </div>

                <p className="text-2xl font-semibold text-foreground">{reais(p.valor_centavos)}</p>
                <p className="text-xs text-muted-foreground">
                  por mês · {p.publico === 'empresa' ? 'Empresário' : 'Escritório'}
                </p>

                {p.publico === 'escritorio' && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground-2">
                    <Users className="size-3.5 shrink-0" />
                    {p.clientes_min ?? 0} a {p.clientes_max ?? '∞'} clientes
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Teste de {p.trial_dias} dias · <span className="text-muted-foreground-2">{emUso} em uso</span>
                </p>
              </header>

              <div className="mt-auto flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => abrirEdicao(p)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  <Pencil className="size-3.5" /> Editar plano
                </button>
                <button
                  type="button"
                  disabled={pending || !p.ativo}
                  onClick={() => desativar(p.id)}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors disabled:opacity-40 ${
                    p.ativo
                      ? 'border-border text-muted-foreground-2 hover:border-destructive hover:text-destructive'
                      : 'cursor-default border-border/50 text-muted-foreground'
                  }`}
                >
                  <Power className="size-3.5" /> Desativar plano
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {edit && (
        <form
          className="max-w-md space-y-3 rounded-md border border-border bg-surface p-4"
          onSubmit={(e) => { e.preventDefault(); salvar(edit); }}
        >
          <h2 className="text-sm font-medium text-foreground">Editar {edit.nome}</h2>

          <label className="block text-xs text-muted-foreground">Nome
            <input className={campo} value={edit.nome}
              onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
          </label>

          <label className="block text-xs text-muted-foreground">Valor (R$)
            <input type="text" inputMode="decimal" className={campo}
              value={valorTexto} placeholder="199,00"
              onChange={(e) => setValorTexto(e.target.value)} />
          </label>

          <label className="block text-xs text-muted-foreground">Dias de teste
            <input type="number" min="0" className={campo}
              value={edit.trial_dias}
              onChange={(e) => setEdit({ ...edit, trial_dias: parseInt(e.target.value || '0', 10) })} />
            <span className="mt-1 block text-xs text-muted-foreground">
              Vale para quem se cadastrar a partir de agora.
            </span>
          </label>

          {edit.publico === 'escritorio' && (
            <div className="flex gap-3">
              <label className="block flex-1 text-xs text-muted-foreground">De (clientes)
                <input type="number" min="0" className={campo}
                  value={edit.clientes_min ?? 0}
                  onChange={(e) => setEdit({
                    ...edit, clientes_min: parseInt(e.target.value || '0', 10),
                  })} />
              </label>
              <label className="block flex-1 text-xs text-muted-foreground">Até (vazio = sem limite)
                <input type="number" min="0" className={campo}
                  value={edit.clientes_max ?? ''}
                  onChange={(e) => setEdit({
                    ...edit,
                    clientes_max: e.target.value === '' ? null : parseInt(e.target.value, 10),
                  })} />
              </label>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50">
              Salvar
            </button>
            <button type="button" onClick={() => setEdit(null)}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
