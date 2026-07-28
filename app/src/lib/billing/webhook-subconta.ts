// Bloco 4B — o webhook da SUBCONTA: regras puras.
//
// POR QUE ESTE MODULO EXISTE
// A emissao de cobranca pela subconta ja funcionava e a rota
// `api/webhooks/asaas` ja sabia rotear evento de subconta para
// `cobrancas_escritorio` — mas NINGUEM cadastrava webhook NA SUBCONTA. O
// webhook da conta-mae, cadastrado a mao no painel, entrega so os eventos DA
// CONTA-MAE. Resultado: o escritorio emitia a cobranca e nunca ficava sabendo
// que ela foi paga. Este modulo e a metade decidivel desse conserto; o I/O mora
// em `webhook-subconta-asaas.ts`.
//
// O QUE FOI OBSERVADO NO SANDBOX (28/07) — nao e o que a doc promete:
//
//   POST /v3/webhooks  → HTTP **200** (nao 201), devolve o objeto criado.
//   Obrigatorios, um a um, provocando a validacao com corpo incompleto:
//     name, url, email, enabled, interrupted, sendType, events (>= 1).
//     (`interrupted` satisfaz o erro que fala em `poolInterrupted`.)
//   `authToken` e OPCIONAL para o Asaas e exige >= 32 caracteres.
//
//   ⚠️ O ACHADO QUE MUDA O DESENHO: mandar o POST **sem** `authToken` nao
//   deixa a configuracao sem token — o Asaas GERA um (`whsec_…`) e devolve
//   `hasAuthToken: true`. Como o segredo nunca volta na leitura, um webhook
//   cadastrado a mao no painel e, PARA QUEM LE, identico a um cadastrado por
//   nos: mesma url, `enabled: true`, `hasAuthToken: true` — e mesmo assim
//   TODA entrega dele morre no `unauthorized` da nossa rota, porque o segredo
//   nao e o `ASAAS_WEBHOOK_SECRET`. Nao da para diagnosticar isso lendo.
//   Dai `montarPayloadWebhook` servir tanto para POST quanto para PUT: a
//   reescrita e o unico conserto, e por isso a acao de reparo existe mesmo
//   quando o diagnostico diz 'ok'.
//
//   DEDUPLICACAO: a chave e SO A URL. Um segundo POST com a mesma url e nome
//   diferente, subconjunto de eventos ou outro `sendType` responde 400 "Já
//   existe uma configuração para os eventos com os mesmos atributos". Isso da
//   idempotencia de graca: mesmo perdendo a corrida entre listar e criar, o
//   pior caso e um 400, nunca dois webhooks na mesma url.
//
// Puro de proposito: sem `server-only`, sem env, sem I/O — a base da URL entra
// por parametro. Arquivo 'use server' so exporta funcao async, e o vitest deste
// repo so alcanca `src/**/*.test.ts`.

import type { AsaasWebhook, PayloadWebhook } from '@/lib/clients/asaas';

/**
 * Exatamente os eventos que `traduzirEvento` (lib/billing/eventos.ts) sabe ler.
 * Pedir menos e ficar cego para um efeito que a rota trata; pedir mais e
 * receber entrega que vira `evento_desconhecido` e gasta entrega penalizada do
 * Asaas a toa.
 */
export const EVENTOS_WEBHOOK = [
  'PAYMENT_CREATED',
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
] as const;

/** O caminho da rota que ja existe e ja valida o segredo. */
export const CAMINHO_WEBHOOK = '/api/webhooks/asaas';

/** Aparece no painel do Asaas DO ESCRITORIO — ele precisa entender o que e
 *  isso e nao apagar achando que e lixo. */
export const NOME_WEBHOOK = 'Balu — avisos de pagamento';

/** Observado: "O token deve ter pelo menos 32 caracteres." */
export const MIN_SEGREDO = 32;

export function urlWebhookSubconta(base: string): string {
  return `${base.replace(/\/+$/, '')}${CAMINHO_WEBHOOK}`;
}

/**
 * O Asaas aceitou `https://exemplo.invalido/...` sem piscar — ele NAO confere
 * se a url responde no cadastro. Entao a checagem tem de ser nossa, e antes:
 * cadastrar `http://localhost:3000/...` cria uma configuracao permanente que
 * nunca vai entregar E, por causa da deduplicacao por url, nao atrapalha a url
 * boa — mas suja o painel do escritorio e mente no diagnostico.
 *
 * Exige https porque o Asaas nao entrega em http e porque o segredo viaja no
 * header: em claro, o `ASAAS_WEBHOOK_SECRET` de TODOS os escritorios vazaria
 * no primeiro salto.
 */
export function ehUrlEntregavel(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return false;
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.invalido')) return false;
  // Sem ponto no host nao ha nome publico resolvivel (ex.: `http://app`).
  return host.includes('.');
}

/** O segredo tem de existir E ter >= 32 chars, senao o cadastro morre no 400 —
 *  e um segredo curto demais nem chega a ser cadastrado, o que deixaria o
 *  escritorio sem avisos sem ninguem entender por que. */
export function segredoUtilizavel(segredo: string | undefined | null): boolean {
  return typeof segredo === 'string' && segredo.length >= MIN_SEGREDO;
}

/**
 * A FORMA CANONICA — a mesma para POST e para PUT.
 *
 * `sendType: 'SEQUENTIALLY'` de proposito: o Asaas para a fila no primeiro erro
 * em vez de seguir mandando. Para dinheiro isso e o lado certo — um evento
 * perdido no meio vira buraco silencioso; a fila parada fica VISIVEL em
 * `interrupted`, e a reconciliacao por varredura (Task 13) cobre a janela.
 *
 * `interrupted: false` nao e enfeite: no PUT ele e o que RETOMA uma fila que o
 * Asaas interrompeu depois de entregas falhas.
 */
export function montarPayloadWebhook(
  url: string,
  segredo: string,
  email: string,
): PayloadWebhook {
  return {
    name: NOME_WEBHOOK,
    url,
    email,
    enabled: true,
    interrupted: false,
    sendType: 'SEQUENTIALLY',
    authToken: segredo,
    events: [...EVENTOS_WEBHOOK],
  };
}

/**
 * Estado do webhook da Balu na subconta.
 *
 * 'ok' e o melhor que a LEITURA consegue afirmar — e ele NAO prova que o
 * segredo confere (ver o cabecalho). E "nao ha nada visivelmente errado", nao
 * "esta entregando".
 */
export type DiagnosticoWebhook =
  | { estado: 'ok'; id: string; penalizadas: number }
  | { estado: 'ausente' }
  | { estado: 'desligado'; id: string }
  | { estado: 'interrompido'; id: string; penalizadas: number }
  | { estado: 'eventos_faltando'; id: string; faltando: string[] };

/** Compara url ignorando barra final — a nossa e montada, a do Asaas volta como
 *  foi gravada, e uma barra a mais nao pode virar "webhook ausente" e disparar
 *  um POST que o proprio Asaas vai recusar por duplicidade. */
function mesmaUrl(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export function diagnosticarWebhook(
  webhooks: readonly AsaasWebhook[] | null | undefined,
  urlEsperada: string,
): DiagnosticoWebhook {
  const w = (webhooks ?? []).find((x) => mesmaUrl(x.url ?? '', urlEsperada));
  if (!w) return { estado: 'ausente' };

  const penalizadas = w.penalizedRequestsCount ?? 0;

  // ORDEM POR GRAVIDADE. `interrupted` primeiro: e o estado em que o Asaas
  // DESISTIU de entregar — nada chega, mesmo com tudo o mais correto.
  if (w.interrupted) return { estado: 'interrompido', id: w.id, penalizadas };
  if (!w.enabled) return { estado: 'desligado', id: w.id };

  const presentes = new Set(w.events ?? []);
  const faltando = EVENTOS_WEBHOOK.filter((e) => !presentes.has(e));
  if (faltando.length) return { estado: 'eventos_faltando', id: w.id, faltando };

  return { estado: 'ok', id: w.id, penalizadas };
}

/** O diagnostico exige reescrita? 'ausente' nao entra: la o caminho e criar. */
export function precisaReparo(d: DiagnosticoWebhook): boolean {
  return d.estado === 'desligado' || d.estado === 'interrompido' || d.estado === 'eventos_faltando';
}

/**
 * Por que o webhook nao pode nem ser TENTADO. Sao condicoes do AMBIENTE da
 * Balu, nunca culpa do escritorio — dai as mensagens mandarem falar com o
 * suporte em vez de pedir que ele conserte algo.
 */
export type MotivoImpedido = 'sem_segredo' | 'sem_email' | 'url_nao_entregavel' | 'asaas_falhou';

export const MENSAGEM_IMPEDIDO: Record<MotivoImpedido, string> = {
  sem_segredo:
    'Os avisos de pagamento não estão configurados nesta instalação da Balu. Fale com o suporte da Balu.',
  sem_email:
    'Os avisos de pagamento não estão configurados nesta instalação da Balu. Fale com o suporte da Balu.',
  url_nao_entregavel:
    'Este ambiente da Balu não tem endereço público para receber os avisos do Asaas. Fale com o suporte da Balu.',
  asaas_falhou:
    'O Asaas não respondeu à configuração dos avisos de pagamento. Tente de novo em alguns minutos.',
};

/**
 * O QUE O ESCRITORIO VE quando o webhook nao esta saudavel.
 *
 * `null` = nada a dizer. 'ok' nao vira aviso, e 'indeterminado'/'impedido' sao
 * resolvidos por quem tem o motivo em maos (ver a tela).
 *
 * O texto nunca promete que a cobranca vai falhar — ela nasce e e paga
 * normalmente. O que quebra e a Balu FICAR SABENDO do pagamento, e e isso que
 * precisa estar escrito, senao o escritorio ignora o aviso.
 */
export function avisoDoDiagnostico(d: DiagnosticoWebhook): string | null {
  switch (d.estado) {
    case 'ok':
      return null;
    case 'ausente':
      return 'As cobranças que você emitir vão funcionar normalmente, mas a Balu não vai ficar '
        + 'sabendo quando o cliente pagar — o pagamento só aparece aqui na conferência diária, '
        + 'com atraso. Use "Reconfigurar avisos" para ligar o aviso na hora.';
    case 'desligado':
      return 'O aviso de pagamento existe na sua conta Asaas mas está desligado. Enquanto isso, '
        + 'o pagamento do seu cliente só aparece aqui na conferência diária, com atraso.';
    case 'interrompido':
      return 'O Asaas parou de enviar os avisos de pagamento depois de várias tentativas sem '
        + 'resposta. Os pagamentos continuam entrando, mas só aparecem aqui na conferência '
        + 'diária. Use "Reconfigurar avisos" para retomar.';
    case 'eventos_faltando':
      return 'Os avisos de pagamento estão incompletos: alguns eventos não são enviados, então '
        + 'parte dos pagamentos só aparece aqui na conferência diária.';
  }
}
