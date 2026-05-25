import type { Config } from 'tailwindcss';

// Tokens derivados de:
//  - PRD §5 (paleta primária da marca Balu)
//  - slices/06_design_tokens.json (tokens secundários do export Bubble)
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de marca (PRD §5)
        brand: {
          teal:    '#03B4C6',
          navy:    '#091747',
          danger:  '#D62755',
        },
        // Tokens funcionais do export
        primary:     'rgb(3 180 198)',     // teal
        destructive: 'rgb(214 39 85)',
        success:     'rgb(30 108 48)',
        alert:       'rgb(220 161 20)',
        surface:     'rgb(255 255 255)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
