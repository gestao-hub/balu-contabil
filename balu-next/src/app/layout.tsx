// @custom — ToastProvider plugado manualmente.
import './globals.css';
import type { Metadata } from 'next';
import { Outfit, Syne, Nunito } from 'next/font/google';
import { ToastProvider } from '@/components/Toaster';

// Tipografia da marca (branding/balu-manual-de-marca.html):
// Outfit = corpo, Syne = títulos, Nunito = wordmark "Balu".
const outfit = Outfit({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const syne = Syne({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-head', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['800', '900'], variable: '--font-brand', display: 'swap' });

export const metadata: Metadata = {
  title: 'Balu — Gestão Fiscal',
  description: 'Plataforma SaaS de gestão fiscal e contábil',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${syne.variable} ${nunito.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
