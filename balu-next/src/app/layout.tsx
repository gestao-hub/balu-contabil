// @custom — ToastProvider plugado manualmente.
import './globals.css';
import type { Metadata } from 'next';
import { ToastProvider } from '@/components/Toaster';

export const metadata: Metadata = {
  title: 'Balu — Gestão Fiscal',
  description: 'Plataforma SaaS de gestão fiscal e contábil',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-white text-zinc-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
