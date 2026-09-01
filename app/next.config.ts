import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

/**
 * CABEÇALHOS DE SEGURANÇA.
 *
 * Auditoria de 01/09/2026: a resposta não trazia NENHUM deles — sem
 * `X-Content-Type-Options`, sem `Referrer-Policy`, sem defesa de enquadramento,
 * e com `X-Powered-By: Next.js` anunciando o framework. Não havia `headers()`
 * aqui, nada no `vercel.json` e nenhum middleware, então valia igual em
 * produção.
 *
 * ⚠️ O QUE ESTA LISTA DELIBERADAMENTE NÃO TEM: uma CSP de scripts. Numa app
 * Next.js ela exige nonce por requisição (`middleware` + `headers()`), e uma CSP
 * mal calibrada não degrada — ela QUEBRA a página em branco. Fica como trabalho
 * próprio, com teste. O que entra aqui é o conjunto que não tem como quebrar
 * nada, e `frame-ancestors`, que é a única diretiva de CSP independente de
 * script.
 */
const CABECALHOS_DE_SEGURANCA = [
  // Impede o navegador de "adivinhar" o tipo do conteúdo. Sem isto, um upload
  // servido com o content-type errado pode ser interpretado como script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Enquadramento: as duas formas, porque navegador antigo só entende a
  // primeira e a CSP é quem vale para os atuais. Este app não é embutido em
  // lugar nenhum, então 'none'/DENY não custa nada e fecha clickjacking.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  // A URL de uma tela do Balu carrega id de empresa e de nota. Sem isto ela vai
  // inteira no Referer de todo link externo.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nada aqui usa câmera, microfone ou geolocalização. Negar por padrão evita
  // que um script de terceiro peça em nome da página.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HSTS: a Vercel já serve só HTTPS, mas o cabeçalho é o que impede o
  // downgrade na PRIMEIRA visita depois de expirar o cache do navegador.
  // Sem `preload` de propósito — entrar na lista de preload é irreversível na
  // prática, e é decisão de quem opera o domínio.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // `X-Powered-By: Next.js` só serve para dizer a um atacante qual CVE tentar.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: CABECALHOS_DE_SEGURANCA }];
  },
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
