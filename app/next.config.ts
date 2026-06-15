import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

// PWA: gera /sw.js a partir de src/app/sw.ts. Desativado em dev para não
// interferir no hot-reload do `next dev`.
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist(config);
