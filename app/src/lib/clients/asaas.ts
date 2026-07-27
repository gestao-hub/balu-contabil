// Bloco 4A — Cliente Asaas (assinaturas e cobrancas da propria Balu).
// Secrets NUNCA vao pro frontend. Este modulo so e importavel no server.
//
// Espelha o padrao de focus-nfe.ts: base por env e retry exponencial.
// Diferenca: o Asaas autentica por header `access_token`, nao Basic.
import 'server-only';

const PROD    = 'https://api.asaas.com';
const SANDBOX = 'https://api-sandbox.asaas.com';

function base(): string {
  return process.env.ASAAS_ENV === 'prod' ? PROD : SANDBOX;
}

/** Falha na CHAMADA, nunca no import: o app tem de subir e funcionar
 *  inteiro sem billing enquanto a chave nao chega. Mesmo espirito do
 *  sendEmail, que ja e no-op logado sem chave. */
function apiKey(): string {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error('ASAAS_API_KEY nao configurado');
  return k;
}

const RETRYABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base()}${path}`, {
        method,
        headers: { access_token: apiKey(), 'Content-Type': 'application/json' },
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
