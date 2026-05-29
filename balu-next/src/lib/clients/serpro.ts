// @custom — Onda 4 hardening — Cliente Serpro Integra Contador (PGDAS-D, DAS, declarações)
import 'server-only';

const PROD = 'https://gateway.apiserpro.serpro.gov.br/integra-contador';
const TRIAL = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial';
const TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';

export type SerproEnv = 'prod' | 'trial';

/** Identificador do tipo de pessoa no envelope Serpro. */
export const Tipo = { CPF: 1, CNPJ: 2 } as const;
export type TipoPessoa = (typeof Tipo)[keyof typeof Tipo];

type IdNumero = { numero: string; tipo: TipoPessoa };

export type Envelope = {
  contratante: IdNumero;
  autorPedidoDados: IdNumero;
  contribuinte: IdNumero;
  pedidoDados: {
    idSistema: string;
    idServico: string;
    versaoSistema?: string;
    /** Sempre string (JSON-encoded) — buildEnvelope() faz o stringify se receber objeto. */
    dados: string;
  };
};

// ---------- Cache de token (module-scoped) ----------
let cached: { token: string; expiresAt: number } | null = null;
const TOKEN_SKEW_MS = 60_000; // renova 60s antes de expirar

/**
 * Retorna bearer token, com cache em memória.
 * Token Serpro vale ~3600s; renovamos quando faltam <60s.
 */
async function bearer(): Promise<string> {
  const now = Date.now();
  if (cached && now < cached.expiresAt - TOKEN_SKEW_MS) {
    return cached.token;
  }

  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET não configurados');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Serpro token → ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };

  const ttlMs = (j.expires_in ?? 3600) * 1000;
  cached = { token: j.access_token, expiresAt: now + ttlMs };
  return j.access_token;
}

/** Limpa cache (útil em testes). */
export function _resetSerproTokenCache() {
  cached = null;
}

// ---------- Helpers ----------
/** Normaliza CNPJ: só dígitos, pad com '0' à esquerda até 14. */
export function normalizeCnpj(input: string): string {
  const digits = (input ?? '').replace(/\D+/g, '');
  return digits.padStart(14, '0').slice(-14);
}

/**
 * Monta envelope Serpro. `dados` pode vir como objeto ou string;
 * se objeto, fazemos JSON.stringify internamente (Serpro exige string).
 */
export function buildEnvelope(params: {
  cnpjContratante: string;
  cnpjContribuinte: string;
  cnpjAutor?: string; // default = contratante
  idSistema?: string; // default por convenção do PRD
  idServico: string;
  versaoSistema?: string;
  dados: unknown;
}): Envelope {
  const contratante = normalizeCnpj(params.cnpjContratante);
  const contribuinte = normalizeCnpj(params.cnpjContribuinte);
  const autor = normalizeCnpj(params.cnpjAutor ?? params.cnpjContratante);

  const dadosStr =
    typeof params.dados === 'string' ? params.dados : JSON.stringify(params.dados ?? {});

  return {
    contratante:      { numero: contratante,  tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: autor,        tipo: Tipo.CNPJ },
    contribuinte:     { numero: contribuinte, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: params.idSistema ?? 'PGDASD',
      idServico: params.idServico,
      ...(params.versaoSistema ? { versaoSistema: params.versaoSistema } : {}),
      dados: dadosStr,
    },
  };
}

// ---------- Call ----------
async function call<T>(
  env: SerproEnv,
  action: 'Declarar' | 'Emitir' | 'Consultar',
  envelope: Envelope,
  prodAuth?: ProdAuth,
): Promise<T> {
  const baseUrl = env === 'prod' ? PROD : TRIAL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (env === 'prod') {
    if (!prodAuth) throw new Error('Serpro produção exige token mTLS (accessToken + jwt).');
    headers.Authorization = `Bearer ${prodAuth.accessToken}`;
    headers.jwt_token = prodAuth.jwt;
  } else {
    headers.Authorization = `Bearer ${await bearer()}`;
  }

  const res = await fetch(`${baseUrl}/v1/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Serpro ${action} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const serpro = {
  transmitirDeclaracao: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Declarar', envelope, prodAuth),
  emitirDas: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Emitir', envelope, prodAuth),
  // PGMEI usa o mesmo endpoint /v1/Emitir; nome distinto só para clareza no call site MEI.
  emitirDasMei: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Emitir', envelope, prodAuth),
  consultarDeclaracao: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Consultar', envelope, prodAuth),
};

/** Serviços PGMEI (MEI). */
export const PGMEI_SERVICES = {
  GERAR_DAS_PDF: 'GERARDASPDF21',
} as const;

/** Token mTLS do procurador (produção). */
export type ProdAuth = { accessToken: string; jwt: string };

/** Serviços conhecidos (idServico). */
export const SERPRO_SERVICES = {
  TRANS_DECLARACAO: 'TRANSDECLARACAO11',
  GERAR_DAS:        'GERARDAS12',
  GERAR_DAS_COBR:   'GERARDASCOBRANCA17',
  GERAR_DAS_AVULSO: 'GERARDASAVULSO19',
  CONS_DECLARACAO:  'CONSDECLARACAO13',
  CONS_ULTIMA_DEC:  'CONSULTIMADECREC14',
  OBTER_DECLARACAO: 'OBTERDECLARACAO',
} as const;

/**
 * Códigos de tributo usados em PGDAS-D / apuração.
 * Conferir contra PRD §11.2 antes de produção — valores baseados em convenção Receita/Serpro.
 */
export const TRIBUTO_CODIGOS = {
  IRPJ:   1010,
  CSLL:   1020,
  COFINS: 1031,
  PIS:    1040,
  INSS:   1041,
  ICMS:   1045,
  ISS:    1050,
} as const;
export type TributoCodigo = (typeof TRIBUTO_CODIGOS)[keyof typeof TRIBUTO_CODIGOS];
