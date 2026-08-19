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

function admin(): Record<string, string> | null {
  const t = process.env.UAZAPI_ADMIN_TOKEN;
  return t ? { admintoken: t } : null;
}

/** Cria a instância do escritório. Devolve id e token — o token é a credencial
 *  de envio e precisa ser cifrado ANTES de encostar no banco. */
export async function criarInstancia(
  nomeEscritorio: string,
): Promise<Resultado<{ id: string; token: string }>> {
  const cab = admin();
  if (!cab) return { ok: false, erro: 'UAZAPI_ADMIN_TOKEN não configurado.' };

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
  return chamar('/webhook', { token: tokenInstancia }, {
    enabled: true,
    url: `${siteUrl.replace(/\/+$/, '')}/api/webhooks/uazapi?t=${tokenWebhook}`,
    events: ['messages'],
    excludeMessages: ['wasSentByApi', 'fromMe', 'isGroup'],
  });
}

/** Pede o código de pareamento para um número. O código expira em minutos — a
 *  tela precisa oferecer "gerar outro" desde a primeira versão. */
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
 *  conectado quando existe. */
export async function statusInstancia(
  tokenInstancia: string,
): Promise<Resultado<{ status: string; numero: string | null }>> {
  const r = await chamar('/instance/status', { token: tokenInstancia }, undefined, 'GET');
  if (!r.ok) return r;

  const i = (r.dados.instance ?? r.dados) as Record<string, unknown>;
  return {
    ok: true,
    dados: {
      status: String(i.status ?? 'disconnected'),
      numero: typeof i.owner === 'string' && i.owner ? i.owner.replace(/\D+/g, '') : null,
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
