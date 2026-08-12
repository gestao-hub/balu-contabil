// @custom — ToastProvider plugado manualmente.
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Outfit, Syne, Nunito } from 'next/font/google';
import { ToastProvider } from '@/components/Toaster';
import ThemeProvider from '@/components/ThemeProvider';

// Tipografia da marca (docs/branding/balu-manual-de-marca.html):
// Outfit = corpo, Syne = títulos, Nunito = wordmark "Balu".
const outfit = Outfit({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const syne = Syne({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-head', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['800', '900'], variable: '--font-brand', display: 'swap' });

export const metadata: Metadata = {
  title: 'Balu — Gestão Fiscal',
  description: 'Plataforma SaaS de gestão fiscal e contábil',
  appleWebApp: {
    capable: true,
    title: 'Balu',
    statusBarStyle: 'default',
  },
  // ⚠️ Declarar `icons` aqui DESLIGA a convenção de arquivo do Next
  // (`src/app/icon.svg`): ele para de emitir o <link rel="icon"> sozinho. Era
  // o que acontecia — só o apple-touch era declarado, e a aba do navegador
  // ficava com o ícone genérico enquanto /icon.svg respondia 200 sem ninguém
  // apontar para ele.
  //
  // Ordem importa: o navegador costuma usar o ÚLTIMO ícone que entende. O SVG
  // vem por último para ganhar do PNG onde há suporte (nítido em qualquer
  // zoom e escala com a aba); o PNG de 192 fica como alternativa para quem
  // não renderiza SVG em favicon.
  icons: {
    icon: [
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
    shortcut: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0D3558',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${outfit.variable} ${syne.variable} ${nunito.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
