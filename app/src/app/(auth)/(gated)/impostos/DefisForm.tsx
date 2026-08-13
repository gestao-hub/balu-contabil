// Formulário dirigido por dados: cada grupo do art. 72 vira um accordion, e o
// grupo repetível de sócios ganha adicionar/remover. Mudar grupos.ts muda a tela.
'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { GRUPOS_DEFIS, contarPreenchidos, type CampoDefis } from '@/lib/fiscal/defis/grupos';

type Valores = Record<string, unknown>;
type Socio = Record<string, unknown>;

export default function DefisForm({ inicial, onSalvar }: {
  inicial: Valores;
  onSalvar: (dados: Valores) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [valores, setValores] = useState<Valores>(inicial);
  const [socios, setSocios] = useState<Socio[]>((inicial.socios as Socio[]) ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const progresso = contarPreenchidos(valores);
  const gruposPlanos = GRUPOS_DEFIS.filter((g) => !g.repetivel);
  const grupoSocios = GRUPOS_DEFIS.find((g) => g.repetivel)!;

  function set(chave: string, v: unknown) {
    setValores((prev) => ({ ...prev, [chave]: v }));
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await onSalvar({ ...valores, socios });
      if (!r.ok) setErro(r.error ?? 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {progresso.preenchidos} de {progresso.total} campos preenchidos.
        {' '}A maioria destes dados não está no app — é preciso digitá-los.
      </p>

      {gruposPlanos.map((g) => (
        <details key={g.id} className="rounded-md border border-border bg-surface-2 p-3" open={g.id === 'receitas'}>
          <summary className="cursor-pointer text-sm font-medium">{g.titulo}</summary>
          <p className="mt-1 text-xs text-muted-foreground-2">{g.norma}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {g.campos.map((c) => (
              <CampoInput key={c.chave} campo={c} valor={valores[c.chave]} onChange={(v) => set(c.chave, v)} />
            ))}
          </div>
        </details>
      ))}

      <details className="rounded-md border border-border bg-surface-2 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {grupoSocios.titulo} ({socios.length})
        </summary>
        <p className="mt-1 text-xs text-muted-foreground-2">
          {grupoSocios.norma} · a participação precisa somar 100%.
        </p>
        <div className="mt-3 space-y-3">
          {socios.map((s, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Sócio {i + 1}</span>
                <button type="button" onClick={() => setSocios(socios.filter((_, j) => j !== i))}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
                  <Trash2 className="size-3" /> Remover
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {grupoSocios.campos.map((c) => (
                  <CampoInput
                    key={c.chave} campo={c} valor={s[c.chave]}
                    onChange={(v) => setSocios(socios.map((x, j) => (j === i ? { ...x, [c.chave]: v } : x)))}
                  />
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setSocios([...socios, {}])}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-3">
            <Plus className="size-4" /> Adicionar sócio
          </button>
        </div>
      </details>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <button type="button" onClick={salvar} disabled={salvando}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar rascunho'}
      </button>
    </div>
  );
}

function CampoInput({ campo, valor, onChange }: {
  campo: CampoDefis; valor: unknown; onChange: (v: unknown) => void;
}) {
  if (campo.tipo === 'booleano') {
    return (
      <label className="flex min-h-6 items-center gap-2 text-sm">
        <input type="checkbox" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{campo.label}</span>
      </label>
    );
  }

  const numerico = campo.tipo === 'moeda' || campo.tipo === 'inteiro' || campo.tipo === 'percentual';
  const htmlType = campo.tipo === 'data' ? 'date' : numerico ? 'number' : 'text';

  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">
        {campo.label}{campo.obrigatorio && <span className="text-destructive"> *</span>}
      </span>
      <input
        type={htmlType}
        inputMode={campo.tipo === 'cpf' ? 'numeric' : undefined}
        step={campo.tipo === 'inteiro' ? 1 : campo.tipo === 'texto' ? undefined : '0.01'}
        min={numerico ? 0 : undefined}
        value={(valor as string | number | undefined) ?? ''}
        onChange={(e) => onChange(numerico ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      {campo.ajuda && <span className="mt-1 block text-xs text-muted-foreground-2">{campo.ajuda}</span>}
    </label>
  );
}
