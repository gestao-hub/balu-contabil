'use client';
// P10 — o pedaço visível da sugestão de código de tributação.
//
// A regra que este componente existe para sustentar: **ele nunca troca o código
// sozinho**. Mostra o que foi sugerido, por quê, e espera o clique em "Usar
// este código". Aplicar automaticamente economizaria um clique e transferiria
// para o app uma responsabilidade que é do emissor da nota.
import { useState } from 'react';
import { Loader2, Sparkles, Check } from 'lucide-react';
import { sugerirCodigoServicoAction } from '../sugestao-actions';
import type { SugestaoCodigo } from '@/lib/fiscal/sugerir-codigo';

export default function SugestaoCodigoBox({
  descricao,
  cnae,
  codigoAtual,
  onUsar,
}: {
  descricao: string;
  cnae: string | null;
  codigoAtual: string;
  onUsar: (codigo: string) => void;
}) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestoes, setSugestoes] = useState<SugestaoCodigo[] | null>(null);
  const [porqueIa, setPorqueIa] = useState<string | null>(null);

  async function pedir() {
    setCarregando(true);
    setErro(null);
    setSugestoes(null);
    setPorqueIa(null);
    try {
      const r = await sugerirCodigoServicoAction({ descricao, cnae });
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setSugestoes(r.sugestoes);
      setPorqueIa(r.porqueIa);
    } catch {
      setErro('Não consegui sugerir agora. Escolha o código na lista.');
    } finally {
      setCarregando(false);
    }
  }

  const recomendado = sugestoes?.[0];
  const alternativas = sugestoes?.slice(1) ?? [];

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={pedir}
        disabled={carregando || descricao.trim().length < 8}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground-2 hover:text-foreground disabled:opacity-50 transition"
      >
        {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {carregando ? 'Analisando…' : 'Sugerir código de tributação'}
      </button>

      {erro && (
        <p className="mt-2 text-xs text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
          {erro}
        </p>
      )}

      {recomendado && (
        <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-foreground">{recomendado.codigo}</span>
            <span className="text-sm text-muted-foreground-2">{recomendado.label}</span>
            {codigoAtual === recomendado.codigo ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5" /> já selecionado
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onUsar(recomendado.codigo)}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition"
              >
                Usar este código
              </button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {porqueIa ?? recomendado.motivos.join('; ')}
          </p>

          {alternativas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Outras opções:</span>
              {alternativas.map((s) => (
                <button
                  key={s.codigo}
                  type="button"
                  onClick={() => onUsar(s.codigo)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground-2 hover:text-foreground transition"
                  title={s.motivos.join('; ')}
                >
                  {s.codigo} · {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Sem isto a sugestão vira recomendação — e não é. */}
          <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
            Sugestão automática a partir da descrição. Confira antes de emitir — a
            responsabilidade pelo código na nota é de quem emite.
          </p>
        </div>
      )}
    </div>
  );
}
