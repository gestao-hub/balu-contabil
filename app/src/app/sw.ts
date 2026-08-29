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

// ⚠️ SUSPEITO PRINCIPAL DO BUG-006 (erro React #418 de hidratação, auditoria
// de 29/08/2026). NÃO alterado — leia antes de mexer.
//
// `skipWaiting` + `clientsClaim` juntos significam: um service worker novo
// ativa na hora e assume ABAS JÁ ABERTAS. Depois de um deploy, uma aba que
// carregou o build ANTIGO (HTML antigo, já hidratado) passa a ter os pedidos
// seguintes servidos pelo SW NOVO, cujo precache tem os chunks do build NOVO.
// Documento antigo + JS novo = mismatch de hidratação, UMA vez, e nunca mais
// depois do reload — porque aí tudo é do build novo.
//
// Isso explica cada evidência que a auditoria registrou, e nenhuma outra
// hipótese explicou: ocorrência única na sessão inicial; aba limpa posterior
// não repetiu; nenhum 4xx/5xx correlacionado (o SW responde 200 do cache); e
// "escopo exato não isolado" — porque não é de um componente, é do build.
// As outras duas hipóteses foram descartadas por leitura: o tema está correto
// (`suppressHydrationWarning` no <html> + guarda `mounted` no ThemeToggle), e
// não há `localStorage` em nenhum componente do produto.
//
// POR QUE NÃO CORRIGI. As duas saídas conhecidas têm custo real, e a escolha é
// de produto, não minha:
//   (a) `skipWaiting: false` + `clientsClaim: false` — acaba o mismatch, mas o
//       usuário fica num build velho até fechar TODAS as abas. Num app fiscal
//       isso significa alguém emitindo nota com código de duas versões atrás.
//   (b) manter, e recarregar a aba em `controllerchange` — é a mitigação
//       padrão, mas um reload involuntário no meio de um formulário de nota
//       fiscal perde o que a pessoa digitou. Pior que o aviso.
// É P3 e a auditoria não comprovou bloqueio visual nenhum. Fica registrado com
// o diagnóstico pronto; se voltar a aparecer, comece por aqui e não pelos
// componentes de data.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
