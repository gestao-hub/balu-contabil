// Provisionamento de instância na uazapi — as quatro chamadas administrativas.
//
// Todas VALIDADAS AO VIVO em 19/08/2026 contra `grupoide.uazapi.com`, criando
// e pareando a instância `Balu - avisos`. O que está aqui é o que funcionou,
// não o que a documentação diz (ela é um SPA que não expõe contrato).
//
// ⚠️ O SERVIDOR É COMPARTILHADO: em 19/08 ele hospedava 37 instâncias, quase
// todas de clientes de outros produtos. Este módulo só CRIA instância nova e
// nunca lista, altera ou apaga as existentes — e o nome sempre leva o prefixo
// `balu-`, para ninguém se confundir do outro lado.
//
// O `UAZAPI_ADMIN_TOKEN` só existe aqui. Ele provisiona qualquer instância do
// servidor; jamais pode chegar ao cliente nem virar resposta de action.
import 'server-only';
import { adminTokenDaUazapi } from './config-plataforma';

const TIMEOUT_MS = 20_000;

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

function base(): string | null {
  return process.env.UAZAPI_BASE_URL?.replace(/\/+$/, '') || null;
}

async function chamar(
  caminho: string, cabecalho: Record<string, string>, corpo?: unknown, metodo = 'POST',
): Promise<Resultado<Record<string, unknown>>> {
  const url = base();
  if (!url) return { ok: false, erro: 'UAZAPI_BASE_URL não configurada.' };

  try {
    const res = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...cabecalho },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Corpo lido SEMPRE, inclusive no erro: a uazapi devolve o motivo em JSON,
    // e "respondeu 400" sozinho não ajuda ninguém a consertar.
    const texto = await res.text();
    let j: Record<string, unknown> = {};
    try { j = texto ? JSON.parse(texto) : {}; } catch { /* corpo não-JSON */ }

    if (!res.ok) {
      const motivo = typeof j.message === 'string' ? j.message : texto.slice(0, 200);
      return { ok: false, erro: `uazapi respondeu ${res.status}: ${motivo}` };
    }
    return { ok: true, dados: j };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O cabeçalho de admin, com o token vindo do BANCO (0102) e o ambiente como
 * retaguarda. Assíncrona desde 24/08/2026 — quem chama tem de esperar.
 */
async function admin(): Promise<Record<string, string> | null> {
  const t = await adminTokenDaUazapi();
  return t ? { admintoken: t } : null;
}

/**
 * Sonda o ADMIN TOKEN contra o serviço real, para o botão "Testar" da tela do
 * admin não aprovar credencial que não serve.
 *
 * ✅ MEDIDO em 24/08/2026: `GET /instance/all` com admintoken válido → **200**
 * com a lista de instâncias; com token errado ou sem cabeçalho → **401**. É
 * admin-scoped e só-leitura, então discrimina de verdade sem criar recurso.
 *
 * Lição da sessão 31 embutida: a sonda bate no que a tela PROMETE. Testar este
 * token por um endpoint de instância aprovaria um valor que não provisiona nada.
 *
 * ⚠️ DEVOLVE SÓ A CONTAGEM. A lista traz as instâncias de TODOS os produtos
 * hospedados no servidor compartilhado, com os tokens delas — nada disso pode
 * chegar à tela nem ao log.
 */
export async function sondarAdminToken(token: string): Promise<Resultado<{ instancias: number }>> {
  const url = base();
  if (!url) return { ok: false, erro: 'UAZAPI_BASE_URL não configurada.' };
  try {
    const res = await fetch(`${url}/instance/all`, {
      headers: { admintoken: token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { ok: false, erro: 'A uazapi recusou este admin token (401). Confira o valor no painel deles.' };
    }
    if (!res.ok) return { ok: false, erro: `uazapi respondeu ${res.status} ao testar o admin token.` };
    const j = await res.json();
    return { ok: true, dados: { instancias: Array.isArray(j) ? j.length : 0 } };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Cria a instância do escritório. Devolve id e token — o token é a credencial
 *  de envio e precisa ser cifrado ANTES de encostar no banco. */
export async function criarInstancia(
  nomeEscritorio: string,
): Promise<Resultado<{ id: string; token: string }>> {
  const cab = await admin();
  if (!cab) {
    return {
      ok: false,
      erro: 'O admin token da uazapi não está configurado. Cadastre-o em '
        + 'Admin → Configurações → WhatsApp da plataforma.',
    };
  }

  // Prefixo obrigatório: o servidor é compartilhado com instâncias de outros
  // produtos, e quem olhar a lista de lá precisa saber o que é nosso.
  const nome = `balu-${nomeEscritorio}`.slice(0, 60);
  const r = await chamar('/instance/init', cab, { name: nome });
  if (!r.ok) return r;

  const i = (r.dados.instance ?? r.dados) as Record<string, unknown>;
  const id = typeof i.id === 'string' ? i.id : '';
  const token = typeof i.token === 'string' ? i.token : '';
  if (!id || !token) return { ok: false, erro: 'uazapi não devolveu id/token da instância.' };
  return { ok: true, dados: { id, token } };
}

/** Aponta o webhook da instância para o nosso endpoint, com o token DO
 *  ESCRITÓRIO na URL — é isso que identifica o tenant na entrada.
 *
 *  `excludeMessages` não é opcional: sem ele, grupo e eco da própria instância
 *  entram no atendimento. Foi assim que, em 12/08, conversas de terceiros
 *  viraram linha no banco. */
export async function configurarWebhook(
  tokenInstancia: string, siteUrl: string, tokenWebhook: string,
): Promise<Resultado<Record<string, unknown>>> {
  return configurarWebhookUrl(
    tokenInstancia,
    `${siteUrl.replace(/\/+$/, '')}/api/webhooks/uazapi?t=${tokenWebhook}`,
  );
}

/**
 * A camada baixa: aponta o webhook para uma URL JÁ MONTADA.
 *
 * Existe porque o canal da PLATAFORMA (0101) entra na mesma rota por outra
 * porta — `?s=<UAZAPI_WEBHOOK_SECRET>` em vez de `?t=<token do escritório>`,
 * que é como `/api/webhooks/uazapi` distingue os dois. Reaproveitar
 * `configurarWebhook` para isso produziria `https://site?s=SEGREDO/api/...`:
 * uma URL sintaticamente válida, aceita pela uazapi, e que nunca entregaria
 * mensagem nenhuma.
 *
 * `excludeMessages` não é opcional aqui tampouco: sem ele, grupo e eco da
 * própria instância entram no atendimento.
 */
export async function configurarWebhookUrl(
  tokenInstancia: string, url: string,
): Promise<Resultado<Record<string, unknown>>> {
  return chamar('/webhook', { token: tokenInstancia }, {
    enabled: true,
    url,
    events: ['messages'],
    excludeMessages: ['wasSentByApi', 'fromMe', 'isGroup'],
  });
}

/**
 * Pede o QR CODE de conexão. É o mesmo `/instance/connect` do pareamento por
 * código, SEM o campo `phone` — e é essa ausência que troca `paircode` por
 * `qrcode` na resposta.
 *
 * ✅ CONTRATO CONFIRMADO ao vivo em 24/08/2026 contra `grupoide.uazapi.com`:
 * HTTP 200, `instance.qrcode` já vem como **data-URI pronta**
 * (`data:image/png;base64,…`, ~1,8 KB) e `instance.status` vira `connecting`.
 * Não há biblioteca de QR envolvida de nenhum lado — a tela põe a string
 * inteira num `<img src>`.
 *
 * O QR ROTACIONA SOZINHO no servidor (medido: 1834 → 1850 chars em 20s), e
 * `statusInstancia` devolve sempre o atual. Por isso a tela NÃO precisa
 * rechamar esta função para renovar: o polling de status já traz o QR novo.
 * Rechamar só faz sentido quando o `connecting` inteiro caducar.
 */
export async function pedirQrCode(
  tokenInstancia: string,
): Promise<Resultado<{ qrcode: string; status: string }>> {
  const r = await chamar('/instance/connect', { token: tokenInstancia }, {});
  if (!r.ok) return r;

  const i = (r.dados.instance ?? r.dados) as Record<string, unknown>;
  const qrcode = typeof i.qrcode === 'string' ? i.qrcode : '';
  // String vazia é o que a uazapi devolve quando NÃO há QR (instância já
  // conectada, ou ainda sem sessão). Tratar como sucesso mandaria a tela
  // renderizar um `<img src="">` — quadrado quebrado, sem explicação.
  if (!qrcode) {
    const jaConectado = String(i.status ?? '') === 'connected';
    return {
      ok: false,
      erro: jaConectado
        ? 'Esta instância já está conectada. Desconecte o número atual antes de ler um QR novo.'
        : 'A uazapi não devolveu o QR code. Tente novamente.',
    };
  }
  return { ok: true, dados: { qrcode, status: String(i.status ?? 'connecting') } };
}

/** Pede o código de pareamento para um número. O código expira em minutos — a
 *  tela precisa oferecer "gerar outro" desde a primeira versão.
 *
 *  CONTINUA EXISTINDO depois do QR virar o caminho principal, e não é código
 *  morto: **não dá para escanear o QR com o mesmo aparelho que se quer
 *  conectar**. Escritório com um celular só não tem outra saída senão o
 *  código. */
export async function pedirPareamento(
  tokenInstancia: string, telefone: string,
): Promise<Resultado<{ paircode: string; status: string }>> {
  const r = await chamar('/instance/connect', { token: tokenInstancia }, { phone: telefone });
  if (!r.ok) return r;

  const i = (r.dados.instance ?? r.dados) as Record<string, unknown>;
  const paircode = typeof i.paircode === 'string' ? i.paircode : '';
  if (!paircode) {
    return { ok: false, erro: 'A uazapi não devolveu código de pareamento. Tente novamente.' };
  }
  return { ok: true, dados: { paircode, status: String(i.status ?? 'connecting') } };
}

/** Status atual: `connected` | `connecting` | `disconnected`, mais o número
 *  conectado quando existe e o QR corrente quando a conexão está em curso.
 *
 *  O `qrcode` sai daqui, e não de uma segunda chamada, porque o servidor
 *  mantém o QR vivo e o rotaciona sozinho (confirmado em 24/08/2026). Uma
 *  requisição por ciclo de polling entrega as duas coisas que a tela precisa:
 *  o código novo e o momento em que ele deixou de ser necessário. */
export async function statusInstancia(
  tokenInstancia: string,
): Promise<Resultado<{ status: string; numero: string | null; qrcode: string | null }>> {
  const r = await chamar('/instance/status', { token: tokenInstancia }, undefined, 'GET');
  if (!r.ok) return r;

  const i = (r.dados.instance ?? r.dados) as Record<string, unknown>;
  return {
    ok: true,
    dados: {
      status: String(i.status ?? 'disconnected'),
      numero: typeof i.owner === 'string' && i.owner ? i.owner.replace(/\D+/g, '') : null,
      // Vazia quando não há QR — normaliza para null e a tela decide com `??`.
      qrcode: typeof i.qrcode === 'string' && i.qrcode ? i.qrcode : null,
    },
  };
}

/** Desconecta o número da instância. A INSTÂNCIA CONTINUA EXISTINDO — é assim
 *  que se troca o aparelho sem perder token, webhook nem histórico. */
export async function desconectarInstancia(
  tokenInstancia: string,
): Promise<Resultado<Record<string, unknown>>> {
  return chamar('/instance/disconnect', { token: tokenInstancia });
}
