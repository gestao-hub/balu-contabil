import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // 20mb. Subi para 100mb em 29/08/2026 e REVERTI no mesmo dia, porque o
      // número não destrava nada: **o teto real está acima do Next.js**. Esta
      // app roda na Vercel, que rejeita bodies acima de ~4,5 MB com 413 ANTES
      // do handler — fato que `api/contador/logo/route.ts:15` já registrava e
      // que eu não tinha lido. Qualquer valor daqui para cima é teatro: não
      // aumenta o que passa, e afrouxa o limite de TODA Server Action do app,
      // cujo corpo é bufferizado em memória.
      //
      // Este número também é citado por `lib/billing/comprovante-liberacao.ts`
      // (linhas 18 e 82) para dimensionar o upload de comprovante — mudá-lo sem
      // mexer lá deixaria aqueles cálculos errados.
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
