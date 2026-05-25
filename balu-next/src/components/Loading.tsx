// Origem: reusable Bubble `Loading` (Group com 1 spinner + texto opcional).
import { Loader2 } from 'lucide-react';

export type LoadingProps = {
  /** Texto exibido abaixo do spinner (param Bubble: `Mensagem`). */
  label?: string;
  /** Se true, ocupa a tela inteira com backdrop semi-opaco. */
  fullscreen?: boolean;
};

export default function Loading({ label, fullscreen = false }: LoadingProps) {
  const inner = (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <Loader2 className="size-8 animate-spin text-primary" />
      {label ? <p className="text-base font-bold text-zinc-700">{label}</p> : null}
      <span className="sr-only">Carregando{label ? `: ${label}` : ''}</span>
    </div>
  );

  if (!fullscreen) return inner;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-white/70 backdrop-blur-sm">
      {inner}
    </div>
  );
}
