// Logo da marca Balu — geometria canônica do manual (branding/balu-manual-de-marca.html).
// Símbolo = "u" com sorriso (viewBox 0 0 200 224, traço 34, pontas arredondadas).
// Gradiente oficial vertical #0D3558 → #1882C8.
//
// Componente puro (sem hooks) → seguro em Server e Client Components.

export type LogoTone = 'gradient' | 'white' | 'currentColor';

type LogoProps = {
  /** 'full' = símbolo + wordmark "Balu"; 'symbol' = só o símbolo. */
  variant?: 'full' | 'symbol';
  /** Cor do símbolo/wordmark. */
  tone?: LogoTone;
  /** Classe do wrapper (controla tamanho via font-size/height). */
  className?: string;
  /** Altura do símbolo em px (default 28). A wordmark acompanha. */
  size?: number;
};

// Gradiente compartilhado: como é sempre idêntico, um id fixo é seguro
// (o navegador resolve url(#id) pelo primeiro match).
const GRAD_ID = 'baluLogoGrad';

function symbolStroke(tone: LogoTone): string {
  if (tone === 'white') return '#FFFFFF';
  if (tone === 'currentColor') return 'currentColor';
  return `url(#${GRAD_ID})`;
}

function BaluSymbol({ tone, size }: { tone: LogoTone; size: number }) {
  // proporção do viewBox 200x224
  const width = (size * 200) / 224;
  return (
    <svg
      viewBox="0 0 200 224"
      width={width}
      height={size}
      fill="none"
      role="img"
      aria-label="Símbolo Balu"
      className="shrink-0"
    >
      {tone === 'gradient' && (
        <defs>
          <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#0D3558" />
            <stop offset="1" stopColor="#1882C8" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M 46 18 L 46 116 Q 46 160 100 160 Q 154 160 154 116 L 154 18"
        stroke={symbolStroke(tone)}
        strokeWidth="34"
        strokeLinecap="round"
      />
      <path
        d="M 22 184 Q 100 226 178 184"
        stroke={symbolStroke(tone)}
        strokeWidth="34"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Logo({
  variant = 'full',
  tone = 'gradient',
  className = '',
  size = 28,
}: LogoProps) {
  const wordmarkCls =
    tone === 'gradient'
      ? 'bg-gradient-to-br from-primary to-primary-light bg-clip-text text-transparent'
      : tone === 'white'
        ? 'text-white'
        : 'text-current';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BaluSymbol tone={tone} size={size} />
      {variant === 'full' && (
        <span
          className={`font-brand font-extrabold leading-none ${wordmarkCls}`}
          style={{ fontSize: size * 0.82 }}
        >
          Balu
        </span>
      )}
    </span>
  );
}
