// Bloco 4A — Cliente Asaas (assinaturas e cobrancas da propria Balu).
// Secrets NUNCA vao pro frontend. Este modulo so e importavel no server.
//
// Espelha o padrao de focus-nfe.ts: base por env e retry exponencial.
// Diferenca: o Asaas autentica por header `access_token`, nao Basic.
import 'server-only';

const PROD    = 'https://api.asaas.com';
const SANDBOX = 'https://api-sandbox.asaas.com';

/** 'prod' só quando explicitamente pedido. Qualquer outro valor — inclusive
 *  ausente — é sandbox: o default nunca pode ser o que cobra de verdade. */
function ehProd(): boolean {
  return process.env.ASAAS_ENV === 'prod';
}

function base(): string {
  return ehProd() ? PROD : SANDBOX;
}

/**
 * Token POR AMBIENTE, e não um `ASAAS_API_KEY` único.
 *
 * O ambiente e o token andam juntos: token de sandbox na URL de produção (ou
 * o contrário) dá 401, e um token único convida a apontar a chave de
 * produção para o sandbox sem perceber. É a mesma separação que a Focus faz
 * entre `token_homologacao` e `token_producao` — e a lição do Bloco 5, onde
 * "env e token mudam juntos" está registrado como landmine.
 *
 * Falha na CHAMADA, nunca no import: o app tem de subir e funcionar inteiro
 * sem billing enquanto a chave não chega — mesmo espírito do `sendEmail`,
 * que já é no-op logado sem chave.
 */
function apiKey(): string {
  const nome = ehProd() ? 'TOKEN_ASAAS_PRODUCAO' : 'TOKEN_ASAAS_SANDBOX';
  const k = process.env[nome];
  if (!k) throw new Error(`${nome} nao configurado`);
  return k;
}

const RETRYABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base()}${path}`, {
        method,
        // Sem token explicito, a conta-mae. Com token, a SUBCONTA — e a
        // cobranca nasce pertencendo ao escritorio, nao a Balu.
        headers: { access_token: token ?? apiKey(), 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES - 1) {
          await sleep(BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        // Truncado de proposito: o corpo de erro do Asaas pode trazer dado
        // do cliente, e esta mensagem acaba em log.
        const txt = (await res.text()).slice(0, 500);
        throw new Error(`Asaas ${method} ${path} → ${res.status}: ${txt}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || /timeout|ETIMEDOUT|ECONNRESET/i.test(err.message));
      if (isTimeout && attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Asaas ${method} ${path} → falhou apos ${MAX_RETRIES} tentativas`);
}

export type AsaasCliente = { id: string; name: string; cpfCnpj: string };
export type AsaasAssinatura = {
  id: string; customer: string; value: number; cycle: string;
  status: string; nextDueDate: string;
};
export type AsaasCobranca = {
  id: string; subscription?: string; value: number; dueDate: string;
  status: string; invoiceUrl?: string; billingType?: string;
};

export const asaas = {
  criarCliente: (d: { name: string; cpfCnpj: string; email?: string }) =>
    call<AsaasCliente>('POST', '/v3/customers', d),

  criarAssinatura: (d: {
    customer: string; billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';
    value: number; nextDueDate: string; cycle: 'MONTHLY' | 'YEARLY'; description?: string;
  }) => call<AsaasAssinatura>('POST', '/v3/subscriptions', d),

  atualizarAssinatura: (id: string, d: { value?: number; description?: string }) =>
    call<AsaasAssinatura>('POST', `/v3/subscriptions/${id}`, d),

  cancelarAssinatura: (id: string) =>
    call<{ deleted: boolean; id: string }>('DELETE', `/v3/subscriptions/${id}`),

  consultarAssinatura: (id: string) =>
    call<AsaasAssinatura>('GET', `/v3/subscriptions/${id}`),

  consultarCobranca: (id: string) =>
    call<AsaasCobranca>('GET', `/v3/payments/${id}`),

  listarCobrancas: (subscriptionId: string) =>
    call<{ data: AsaasCobranca[] }>('GET', `/v3/subscriptions/${subscriptionId}/payments`),

  pixDaCobranca: (id: string) =>
    call<{ payload?: string; encodedImage?: string }>('GET', `/v3/payments/${id}/pixQrCode`),
};

export type AsaasSubconta = {
  id: string; walletId: string; apiKey: string;
  name: string; email: string; cpfCnpj: string;
};

/** Resposta de `GET /v3/myAccount/status` — os quatro eixos de KYC da conta
 *  cujo token foi usado. Levantado contra o sandbox, nao contra a doc:
 *  {"id","commercialInfo","bankAccountInfo","documentation","general"}, todos
 *  string maiuscula. Quem traduz para o vocabulario da coluna e
 *  `@/lib/billing/status-subconta`. */
export type AsaasStatusConta = {
  id: string;
  commercialInfo: string;
  bankAccountInfo: string;
  documentation: string;
  general: string;
};

/** Criação de subconta — vai SEMPRE pela conta-mãe. */
export const asaasContaMae = {
  criarSubconta: (d: Record<string, unknown>) =>
    call<AsaasSubconta>('POST', '/v3/accounts', d),
  listarSubcontas: () =>
    call<{ totalCount: number; data: { id: string; name: string }[] }>('GET', '/v3/accounts?limit=100'),
};

/**
 * Cliente com a identidade da SUBCONTA. Tudo o que emite cobrança do
 * escritório passa por aqui — o `token` é a apiKey decifrada, e nunca
 * pode vir do navegador nem aparecer em log.
 */
export function asaasSub(token: string) {
  if (!token) throw new Error('asaasSub: token da subconta ausente');
  return {
    criarCliente: (d: { name: string; cpfCnpj: string; email?: string }) =>
      call<AsaasCliente>('POST', '/v3/customers', d, token),

    criarCobranca: (d: {
      customer: string; billingType: 'BOLETO' | 'PIX' | 'UNDEFINED';
      value: number; dueDate: string; description?: string; externalReference?: string;
    }) => call<AsaasCobranca>('POST', '/v3/payments', d, token),

    consultarCobranca: (id: string) =>
      call<AsaasCobranca>('GET', `/v3/payments/${id}`, undefined, token),

    listarCobrancas: () =>
      call<{ data: AsaasCobranca[] }>('GET', '/v3/payments?limit=100', undefined, token),

    pixDaCobranca: (id: string) =>
      call<{ payload?: string; encodedImage?: string }>('GET', `/v3/payments/${id}/pixQrCode`, undefined, token),

    /**
     * KYC da PROPRIA subconta. `myAccount` significa "a conta do token" — com o
     * token da conta-mae isto devolveria o KYC da Balu, e a Balu esta sempre
     * aprovada: o `, token` aqui e a diferenca entre ler o cadastro do
     * escritorio e carimbar toda subconta como aprovada. Nao ha rota
     * equivalente por subconta na conta-mae (`GET /v3/accounts` so lista
     * `{ id, name }`).
     */
    consultarStatusConta: () =>
      call<AsaasStatusConta>('GET', '/v3/myAccount/status', undefined, token),
  };
}
