import type { MetadataRoute } from 'next';

// Manifest PWA — servido em /manifest.webmanifest pelo Next 15.
// Cores e ícones derivados do manual de marca (docs/branding).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Balu — Gestão Fiscal',
    short_name: 'Balu',
    description: 'Plataforma SaaS de gestão fiscal e contábil',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#090909',
    theme_color: '#0D3558',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { src: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
      {
        src: '/icons/maskable-512.png',
        type: 'image/png',
        sizes: '512x512',
        purpose: 'maskable',
      },
    ],
  };
}
