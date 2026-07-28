'use client';
// src/app/(auth)/(gated)/contador/configuracoes/avulsos/CatalogoAvulsos.tsx
// Bloco 4B — catálogo de serviços avulsos: cadastro, edição e situação.
//
// VALOR EM TEXTO, NÃO EM `type="number"`: o escritório digita "1.200,50", e um
// input numérico do navegador em pt-BR ora aceita ora recusa a vírgula conforme
// o locale. O texto passa por `normalizarValorBRL` — o mesmo caminho dos
// honorários — e vira centavos inteiros aqui, antes de sair. O que trafega para
// a action é centavo inteiro; real com casa decimal não chega nem perto do banco.
//
// DESATIVAR É O "REMOVER" DESTA TELA. Apagar só aparece depois que o serviço
// está desativado (ver actions.ts): cobrança emitida aponta para o serviço, e o
// DELETE desligaria a cobrança da sua origem.
//
// SÓ IMPORTA MÓDULO PURO (`@/lib/billing/avulso`, `@/lib/format/dinheiro`) e as
// actions. Módulo com `server-only` importado daqui passa no `tsc --noEmit` e só
// quebra no runtime — mordeu o Bloco 4A.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Pencil, Plus, Power, RotateCcw, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { formatBRL, normalizarValorBRL } from '@/lib/format/dinheiro';
import { validarServicoAvulso, type TipoValor } from '@/lib/billing/avulso';
import {
  salvarServicoAction, definirAtivoServicoAction, apagarServicoAction, semearCatalogoAction,
} from './actions';

export type ServicoVm = {
  id: string;
  nome: string;
  categoria: string | null;
  tipoValor: TipoValor;
  valorCentavos: number | null;
  percentual: number | null;
  ativo: boolean;
};

type FormState = {
  id: string | null;
  nome: string;
  categoria: string;
  tipoValor: TipoValor;
  /** Reais como o usuário digita ("1.200,50"). Convertido no envio. */
  valor: string;
  percentual: string;
  /** Carregado do item em edição: editar o preço de um serviço desativado não
   *  pode reativá-lo por tabela — quem liga e desliga é o botão da lista. */
  ativo: boolean;
};

const VAZIO: FormState = {
  id: null, nome: '', categoria: '', tipoValor: 'fixo', valor: '', percentual: '', ativo: true,
};

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';
const botaoLinha =
  'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium '
  + 'text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50';

/** Texto livre em reais → centavos inteiros. `null` quando não sobra número. */
function centavosDoTexto(texto: string): number | null {
  const s = normalizarValorBRL(texto);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Texto livre → percentual com 2 casas (o que `numeric(5,2)` guarda). */
function percentualDoTexto(texto: string): number | null {
  const s = normalizarValorBRL(texto);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function reaisDoCentavos(c: number | null): string {
  return c == null ? '' : (c / 100).toFixed(2).replace('.', ',');
}

/**
 * Uma linha do catálogo. NO TOPO DO MÓDULO, e não dentro do componente de
 * cima: componente declarado dentro de outro é um tipo novo a cada render, e o
 * React desmonta e remonta a lista inteira a cada tecla digitada no formulário.
 */
function LinhaServico({ s, pending, onEditar, onSituacao, onApagar }: {
  s: ServicoVm;
  pending: boolean;
  onEditar: (s: ServicoVm) => void;
  onSituacao: (s: ServicoVm) => void;
  onApagar: (s: ServicoVm) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {s.nome}
          {!s.ativo && (
            <span className="rounded-md bg-alert/15 px-2 py-0.5 text-xs font-semibold text-alert">
              Desativado
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {s.categoria ?? 'Sem categoria'} ·{' '}
          {s.tipoValor === 'fixo' ? formatBRL(s.valorCentavos ?? 0) : `${s.percentual}% do valor-base`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onEditar(s)} disabled={pending} className={botaoLinha}>
          <Pencil className="size-3.5" /> Editar
        </button>
        <button type="button" onClick={() => onSituacao(s)} disabled={pending} className={botaoLinha}>
          {s.ativo ? <Power className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          {s.ativo ? 'Desativar' : 'Reativar'}
        </button>
        {/* Apagar só aparece depois de desativado — e mesmo aí a action recusa
            se o serviço já foi cobrado de alguém. */}
        {!s.ativo && (
          <button
            type="button"
            onClick={() => onApagar(s)}
            disabled={pending}
            title="Só é possível apagar serviço que nunca foi cobrado"
            className={`${botaoLinha} hover:border-destructive hover:text-destructive`}
          >
            <Trash2 className="size-3.5" /> Apagar
          </button>
        )}
      </div>
    </li>
  );
}

export default function CatalogoAvulsos({ servicos }: { servicos: ServicoVm[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ativos = servicos.filter((s) => s.ativo);
  const inativos = servicos.filter((s) => !s.ativo);
  const editando = form.id !== null;

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function editar(s: ServicoVm) {
    setErro(null);
    setForm({
      id: s.id,
      nome: s.nome,
      categoria: s.categoria ?? '',
      tipoValor: s.tipoValor,
      valor: reaisDoCentavos(s.valorCentavos),
      percentual: s.percentual == null ? '' : String(s.percentual),
      ativo: s.ativo,
    });
    // O formulário fica no topo; sem isto, clicar em "Editar" num item lá
    // embaixo não mostra nada acontecendo.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    const fixo = form.tipoValor === 'fixo';
    const payload = {
      id: form.id,
      nome: form.nome,
      categoria: form.categoria.trim() || null,
      tipoValor: form.tipoValor,
      // Cada tipo manda o SEU campo e `null` no outro — o CHECK do banco proíbe
      // os dois preenchidos, e a validação abaixo recusa antes da viagem.
      valorCentavos: fixo ? centavosDoTexto(form.valor) : null,
      percentual: fixo ? null : percentualDoTexto(form.percentual),
      ativo: form.ativo,
    };

    // As mesmas regras que a action aplica — em português e sem round-trip.
    const v = validarServicoAvulso(payload);
    if (!v.ok) { setErro(v.error); toast('warning', v.error); return; }

    start(async () => {
      const r = await salvarServicoAction(payload);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', form.id ? 'Serviço atualizado.' : 'Serviço adicionado ao catálogo.');
      setForm(VAZIO);
      router.refresh();
    });
  }

  function mudarSituacao(s: ServicoVm) {
    setErro(null);
    start(async () => {
      const r = await definirAtivoServicoAction(s.id, !s.ativo);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', s.ativo ? 'Serviço desativado.' : 'Serviço reativado.');
      router.refresh();
    });
  }

  function apagar(s: ServicoVm) {
    setErro(null);
    start(async () => {
      const r = await apagarServicoAction(s.id);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      // Se o item apagado estava aberto no formulário, o `id` em mãos deixou de
      // existir e um "Salvar" seguinte falharia com "não encontrado".
      setForm((f) => (f.id === s.id ? VAZIO : f));
      toast('success', 'Serviço apagado.');
      router.refresh();
    });
  }

  function semear() {
    setErro(null);
    start(async () => {
      const r = await semearCatalogoAction();
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', 'Lista sugerida criada. Ajuste os valores como quiser.');
      router.refresh();
    });
  }

  const caixaErro = erro && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{erro}</span>
    </p>
  );

  const linha = (s: ServicoVm) => (
    <LinhaServico
      key={s.id}
      s={s}
      pending={pending}
      onEditar={editar}
      onSituacao={mudarSituacao}
      onApagar={apagar}
    />
  );

  return (
    <section className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {editando ? 'Editar serviço' : 'Novo serviço'}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Valor fixo é o preço do serviço. Percentual é a fatia de um valor que só existe na hora
            de cobrar — o crédito recuperado, o serviço a que a urgência se aplica.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={rotuloCampo}>Serviço<span className="text-destructive"> *</span></span>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => set('nome', e.target.value)}
              placeholder="Abertura de empresa"
              maxLength={200}
              required
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>Categoria</span>
            <input
              type="text"
              value={form.categoria}
              onChange={(e) => set('categoria', e.target.value)}
              placeholder="Societário"
              maxLength={100}
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>Como cobra<span className="text-destructive"> *</span></span>
            <select
              value={form.tipoValor}
              // Trocar o tipo LIMPA o campo do outro tipo: o CHECK do banco
              // proíbe os dois preenchidos, e um valor esquecido do tipo antigo
              // viraria erro no envio sem o usuário ver de onde veio.
              onChange={(e) => setForm((f) => ({
                ...f, tipoValor: e.target.value as TipoValor, valor: '', percentual: '',
              }))}
              className={campo}
            >
              <option value="fixo">Valor fixo</option>
              <option value="percentual">Percentual sobre um valor-base</option>
            </select>
          </label>

          {form.tipoValor === 'fixo' ? (
            <label className="flex flex-col gap-1">
              <span className={rotuloCampo}>Valor (R$)<span className="text-destructive"> *</span></span>
              <input
                type="text"
                inputMode="decimal"
                value={form.valor}
                onChange={(e) => set('valor', e.target.value)}
                placeholder="900,00"
                required
                className={campo}
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={rotuloCampo}>Percentual (%)<span className="text-destructive"> *</span></span>
              <input
                type="text"
                inputMode="decimal"
                value={form.percentual}
                onChange={(e) => set('percentual', e.target.value)}
                placeholder="20"
                required
                className={campo}
              />
            </label>
          )}
        </div>

        {/* A caixa de erro fica JUNTO do botão — é onde o olho está depois do clique. */}
        {caixaErro}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? 'Salvando…' : editando ? 'Salvar alterações' : 'Adicionar ao catálogo'}
          </button>

          {editando && (
            <button
              type="button"
              onClick={() => { setForm(VAZIO); setErro(null); }}
              disabled={pending}
              className={botaoLinha}
            >
              <X className="size-3.5" /> Cancelar edição
            </button>
          )}
        </div>
      </form>

      {servicos.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted-foreground">
            Nenhum serviço cadastrado ainda. Você pode começar com uma lista sugerida e ajustar
            nomes e valores — nada nela é obrigatório.
          </p>
          <button
            type="button"
            onClick={semear}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Começar com a lista sugerida
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              No catálogo <span className="text-muted-foreground">({ativos.length})</span>
            </h2>
            {ativos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todos os serviços estão desativados — reative um para poder cobrá-lo.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {ativos.map(linha)}
              </ul>
            )}
          </div>

          {inativos.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                Desativados <span className="text-muted-foreground">({inativos.length})</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Não aparecem na hora de cobrar, mas continuam ligados às cobranças que já foram
                emitidas com eles.
              </p>
              <ul className="flex flex-col gap-2">
                {inativos.map(linha)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
