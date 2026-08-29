import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // 100mb desde 29/08/2026 (era 20mb). O caso que forçou: o envio do
      // documento legal revisado pelo advogado, em
      // `/admin/configuracoes/documentos/[tipo]`. O texto vai ao banco por
      // Server Action, então este número — e não a coluna — era o teto real.
      //
      // A coluna `documento_versoes.conteudo_md` é `text` SEM limite, ou seja
      // ~1 GB por valor no Postgres. NÃO subi para 1 GB de propósito: isto aqui
      // é global, vale para TODA Server Action do app (certificado A1, docs de
      // abertura), e o corpo é bufferizado em memória antes de chegar ao
      // código. Um teto de 1 GB seria superfície de exaustão de memória em
      // troca de nada — nenhuma peça jurídica chega perto de 100 MB.
      //
      // ⚠️ `LIMITE_MB` em `documentos/[tipo]/DocumentoEditor.tsx` espelha este
      // valor. Os dois mudam juntos.
      bodySizeLimit: '100mb',
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
