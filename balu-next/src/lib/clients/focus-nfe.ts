// @custom — Onda 4 hardening — Cliente Focus NFe (NF-e / NFC-e / NFS-e + consultas)
// Secrets NUNCA vão pro frontend. Este módulo só é importável no server.
import 'server-only';

const PROD = 'https://api.focusnfe.com.br';
const HOM  = 'https://homologacao.focusnfe.com.br';
const base = (env: 'prod' | 'hom') => (env === 'prod' ? PROD : HOM);

export type FocusEnv = 'prod' | 'hom';

function auth() {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) throw new Error('FOCUS_NFE_TOKEN não configurado');
  // Focus usa Basic Auth com token como username e senha vazia.
  return 'Basic ' + Buffer.from(token + ':').toString('base64');
}

/** Gera UUID v4 único para usar como `ref` idempotente. Prefixa empresa para debug. */
export function generateRef(empresaId: string): string {
  const uuid = crypto.randomUUID();
  // Trunca empresaId pra ficar legível, mantém uuid completo pra unicidade.
  const prefix = empresaId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return prefix ? `${prefix}-${uuid}` : uuid;
}

export type BinaryResponse = { contentType: string; body: ArrayBuffer };
export type TextResponse   = { contentType: string; body: string };

const RETRYABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * call() adaptativo: detecta Content-Type da resposta.
 * - application/json → parse JSON
 * - application/pdf, application/octet-stream → ArrayBuffer
 * - application/xml, text/xml → string
 * Retry exponencial em 502/503/504/timeout (3 tentativas).
 */
async function call<T>(
  env: FocusEnv,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base(env)}${path}`, {
        method,
        headers: {
          Authorization: auth(),
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });

      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES - 1) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Focus ${method} ${path} → ${res.status}: ${await res.text()}`);
      }

      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct.includes('application/json')) {
        return (await res.json()) as T;
      }
      if (ct.includes('pdf') || ct.includes('octet-stream')) {
        const buf = await res.arrayBuffer();
        return { contentType: ct, body: buf } as unknown as T;
      }
      if (ct.includes('xml')) {
        return { contentType: ct, body: await res.text() } as unknown as T;
      }
      // Fallback: tenta JSON; se falhar devolve texto cru.
      const raw = await res.text();
      try {
        return JSON.parse(raw) as T;
      } catch {
        return { contentType: ct || 'text/plain', body: raw } as unknown as T;
      }
    } catch (err) {
      lastErr = err;
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || /timeout|ETIMEDOUT|ECONNRESET/i.test(err.message));
      if (isTimeout && attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Focus ${method} ${path} → falhou após ${MAX_RETRIES} tentativas`);
}

/**
 * Resposta esperada do POST /v2/empresas (revenda). O campo crítico é `token_producao` /
 * `token_homologacao` — devolvido pela Focus, usado como Basic-auth nas chamadas
 * por-empresa (atualizar, enviar cert via PUT). A doc lista vários outros campos
 * (id, status, etc); aqui só fixamos os que consumimos.
 */
export type FocusEmpresaCriada = {
  token_producao?: string;
  token_homologacao?: string;
  cnpj?: string;
  id?: number;
  // Demais campos devolvidos pela Focus chegam mas não tipamos.
  [k: string]: unknown;
};

/**
 * Snapshot do estado da empresa na Focus, devolvido por GET /v2/empresas/:id.
 * Usado pra alimentar empresas_fiscais.focus_* (Focus 2.0). Mantemos só os
 * campos que a UI/lógica do Balu consome — Focus devolve dezenas, ignoramos.
 */
export type FocusEmpresaSnapshot = {
  id: number;
  cnpj: string;
  municipio?: string | null;
  codigo_municipio?: string | null;
  uf?: string | null;
  habilita_nfse?: boolean | null;
  habilita_nfsen_producao?: boolean | null;
  habilita_nfsen_homologacao?: boolean | null;
  habilita_nfe?: boolean | null;
  habilita_nfce?: boolean | null;
  // Demais campos passam direto via index signature.
  [k: string]: unknown;
};

export const focus = {
  /** GET /v2/cnpjs/:cnpj — consulta dados de empresa */
  consultarCnpj: (cnpj: string, env: FocusEnv = 'prod') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/cnpjs/${cnpj}`),

  /**
   * POST /v2/empresas — cadastra empresa na API de **revenda** da Focus. Retorna
   * `token_homologacao` + `token_producao` próprios da empresa (consumidos nos PUTs
   * subsequentes para emissão em cada ambiente).
   *
   * **Importante:** o endpoint de revenda **só existe em `api.focusnfe.com.br`** —
   * não há versão em `homologacao.focusnfe.com.br` (a "homologação" é por-EMPRESA,
   * aplica-se às emissões, não ao cadastro). O parâmetro `env` aqui é ignorado
   * para o caminho da requisição; mantemos a assinatura simétrica com os demais
   * métodos pra não vazar o detalhe pro caller. Default ignorado por design.
   */
  criarEmpresa: (payload: Record<string, unknown>, _env: FocusEnv = 'hom') =>
    call<FocusEmpresaCriada>('prod', 'POST', `/v2/empresas`, payload),

  /**
   * GET /v2/empresas/:id — consulta empresa por id numérico devolvido no POST.
   * Mesmo motivo de `criarEmpresa`: revenda só existe em `api.focusnfe.com.br`.
   */
  consultarEmpresa: (id: number, _env: FocusEnv = 'hom') =>
    call<FocusEmpresaSnapshot>('prod', 'GET', `/v2/empresas/${id}`),

  /**
   * PUT /v2/empresas/:id — atualiza cadastro da empresa na revenda Focus
   * (regime, habilitação NFS-e, login/senha prefeitura, endereço editado).
   *
   * **Path usa o ID numérico interno** (devolvido pelo POST em `resp.id` e
   * salvo em `empresas_fiscais.focus_empresa_id`), NÃO o CNPJ — confirmado
   * empiricamente em 2026-05-28 (PUT por CNPJ retorna 404) e validado em
   * https://doc.focusnfe.com.br/reference/atualizar_empresa.
   *
   * Idempotente: pode reenviar o mesmo payload sem efeito colateral. Mesmo
   * que `criarEmpresa`/`consultarEmpresa`: revenda só vive em `api.focusnfe.com.br`,
   * então força `'prod'`. O ambiente real (hom/prod) das emissões é decidido
   * por `habilita_nfsen_homologacao` vs `habilita_nfsen_producao` no payload.
   */
  atualizarEmpresa: (id: number, payload: Record<string, unknown>, _env: FocusEnv = 'hom') =>
    call<FocusEmpresaSnapshot>('prod', 'PUT', `/v2/empresas/${id}`, payload),

  // ---------- Emissão ----------
  /** POST /v2/nfe?ref=:ref — emissão NFe (idempotente por ref) */
  emitirNfe: (ref: string, payload: unknown, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfe?ref=${encodeURIComponent(ref)}`, payload),
  /** POST /v2/nfce?ref=:ref */
  emitirNfce: (ref: string, payload: unknown, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload),
  /** POST /v2/nfsen?ref=:ref */
  emitirNfse: (ref: string, payload: unknown, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfsen?ref=${encodeURIComponent(ref)}`, payload),

  // ---------- Status (polling) ----------
  /** GET /v2/nfe/:ref — consulta status da NFe */
  consultarStatusNfe: (ref: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}`),
  /** GET /v2/nfce/:ref */
  consultarStatusNfce: (ref: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}`),
  /** GET /v2/nfsen/:ref */
  consultarStatusNfse: (ref: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}`),

  // ---------- Download (binário/texto) ----------
  /** GET /v2/nfe/:ref.pdf → DANFE em PDF (ArrayBuffer) */
  baixarDanfe: (ref: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}.pdf`),
  /** GET /v2/nfe/:ref.xml → XML da NFe (string) */
  baixarXmlNfe: (ref: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}.xml`),
  /** GET /v2/nfce/:ref.pdf */
  baixarDanfeNfce: (ref: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}.pdf`),
  /** GET /v2/nfce/:ref.xml */
  baixarXmlNfce: (ref: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}.xml`),
  /** GET /v2/nfsen/:ref.pdf */
  baixarDanfeNfse: (ref: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}.pdf`),
  /** GET /v2/nfsen/:ref.xml */
  baixarXmlNfse: (ref: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}.xml`),

  // ---------- Cancelamento ----------
  /**
   * DELETE /v2/nfe/:ref — cancelar (justificativa mínima 15 chars por regra SEFAZ).
   * Valida ANTES do fetch.
   */
  cancelarNfe: (ref: string, justificativa: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres (regra SEFAZ).');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfe/${encodeURIComponent(ref)}`,
      { justificativa },
    );
  },
  /** DELETE /v2/nfce/:ref */
  cancelarNfce: (ref: string, justificativa: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres (regra SEFAZ).');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfce/${encodeURIComponent(ref)}`,
      { justificativa },
    );
  },
  /** DELETE /v2/nfsen/:ref */
  cancelarNfse: (ref: string, justificativa: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres.');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfsen/${encodeURIComponent(ref)}`,
      { justificativa },
    );
  },
};
