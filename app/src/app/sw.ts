// Service worker do Balu (PWA) — compilado pelo @serwist/next, não pelo tsc do app.
// Excluído do tsconfig principal; usa libs de WebWorker via Serwist.
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injetado no build com a lista de assets a pré-cachear.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// BUG-006 (erro React #418 de hidratação, auditoria de 29/08/2026): NÃO ERA AQUI.
//
// Este bloco carregava, desde 29/08, um diagnóstico apontando `skipWaiting` +
// `clientsClaim` como suspeito principal — documento de um build servido junto
// com JS de outro. A hipótese era plausível e explicava as evidências, mas
// nunca foi medida. Em 01/09/2026 a causa real foi reproduzida, comparando a
// mesma expressão nos dois lados:
//
//   new Date('2026-09-01T02:00:00Z').toLocaleDateString('pt-BR')
//     servidor (Node, TZ=UTC como na Vercel)  → "01/09/2026"
//     cliente  (Chromium, America/Sao_Paulo)  → "31/08/2026"
//
// Client component renderiza nos dois lados; strings diferentes é o #418. Com
// hora o desencontro é de 100% dos casos, porque BRT é UTC-3 o ano inteiro.
// Corrigido em `lib/format/data-brt.ts`, com fuso fixo, e travado por um teste
// que varre o fonte (`sem-data-dependente-de-fuso.test.ts`).
//
// O que fica registrado como LIÇÃO, e não como pendência: a hipótese do service
// worker sobreviveu três dias porque explicava todas as evidências. Explicar as
// evidências não é o mesmo que ser a causa — a de fuso explicava igualmente
// bem, e era a única que dava para reproduzir em dois minutos. Medir antes teria
// sido mais barato que escrever o diagnóstico.
//
// `skipWaiting` + `clientsClaim` seguem ligados, agora por decisão e não por
// omissão: num app fiscal, deixar o usuário num build antigo até fechar todas as
// abas é pior do que assumi-las de imediato. Se algum dia aparecer mismatch que
// NÃO seja de fuso, este continua sendo o lugar certo para olhar — mas comece
// reproduzindo, não deduzindo.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
