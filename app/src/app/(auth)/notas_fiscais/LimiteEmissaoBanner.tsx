import type { LimiteEmissao, NivelLimite } from '@/lib/fiscal/limite-emissao';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Cores do tema por nível (track + barra).
const BAR: Record<NivelLimite, string> = {
  verde: 'bg-success',
  amarelo: 'bg-alert',
  vermelho: 'bg-destructive',
};
const TEXT: Record<NivelLimite, string> = {
  verde: 'text-success',
  amarelo: 'text-alert',
  vermelho: 'text-destructive',
};

export default function LimiteEmissaoBanner({ limite }: { limite: LimiteEmissao }) {
  if (!limite.mostrar) return null;
  const { total, limite: teto, pct, nivel, ano } = limite;
  const largura = Math.min(pct, 100);
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">Limite de emissão · {ano}</span>
        <span className={`tabular-nums font-medium ${TEXT[nivel]}`}>
          {brl.format(total)} / {brl.format(teto)} · {pct}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${BAR[nivel]}`} style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}
