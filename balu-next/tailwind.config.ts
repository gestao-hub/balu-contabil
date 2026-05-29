import type { Config } from 'tailwindcss';

// Tokens da marca Balu — derivados de branding/balu-manual-de-marca.html (tema escuro).
// Cores semânticas apontam para CSS vars em globals.css (re-tematização num lugar só).
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semânticos (tema escuro)
        background:           rgb('--background'),
        foreground:           rgb('--foreground'),
        surface:              rgb('--surface'),
        'surface-2':          rgb('--surface-2'),
        'surface-3':          rgb('--surface-3'),
        card:                 rgb('--surface'),
        'muted-foreground':   rgb('--muted-foreground'),
        'muted-foreground-2': rgb('--muted-foreground-2'),
        primary:              rgb('--primary'),
        'primary-light':      rgb('--primary-light'),
        navy:                 rgb('--navy'),
        success:              rgb('--success'),
        destructive:          rgb('--destructive'),
        alert:                rgb('--alert'),
        border:               'rgb(255 255 255 / 0.08)',

        // Paleta de marca explícita (use quando precisar do hex fixo)
        brand: {
          blue:      '#1882C8',
          'blue-lt': '#4AAEE0',
          navy:      '#0D3558',
          success:   '#2ECF8A',
          danger:    '#E05252',
        },
      },
      fontFamily: {
        sans:  ['var(--font-body)', 'Outfit', 'system-ui', 'sans-serif'],
        head:  ['var(--font-head)', 'Syne', 'sans-serif'],
        brand: ['var(--font-brand)', 'Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
