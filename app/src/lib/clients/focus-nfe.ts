// @custom — Onda 4 hardening — Cliente Focus NFe (NF-e / NFC-e / NFS-e + consultas)
// Secrets NUNCA vão pro frontend. Este módulo só é importável no server.
import 'server-only';
import { obterTokenFocus, type AmbienteFocus } from '@/lib/fiscal/config-focus';

const PROD = 'https://api.focusnfe.com.br';
const HOM  = 'https://homologacao.focusnfe.com.br';
const base = (env: 'prod' | 'hom') => (env === 'prod' ? PROD : HOM);

export type FocusEnv = 'prod' | 'hom';

/**
 * Monta o header Basic Auth.
 *
 * - Sem `tokenOverride`: resolve o token da conta da plataforma **no
 *   ambiente pedido** via `obterTokenFocus(ambiente)` — `config_focus` no
 *   banco, com a variável de ambiente correspondente como fallback (0099).
 *   Token de homologação numa chamada a `api.focusnfe.com.br` (ou o inverso)
 *   dá 401 — por isso o ambiente de `auth` tem de ser o mesmo que `call()`
 *   está de fato usando na URL.
 * - Com `tokenOverride`: usa esse token em vez de resolver. Dois usos:
 *     1. endpoints de **emissão** (`/v2/nfsen`, `/v2/nfse`, `/v2/nfe`, etc) —
 *        a Focus exige o `token_homologacao` ou `token_producao` específico
 *        da EMPRESA, salvo em `companies.focus_token` após o POST inicial em
 *        `/v2/empresas`;
 *     2. `consultarEmpresa` chamado pela tela de configuração ANTES de gravar
 *        um token novo (Bloco 5, conserto 1) — precisa sondar com o
 *        candidato que está no formulário, não com o que já está no banco.
 */
async function auth(ambiente: AmbienteFocus, tokenOverride?: string): Promise<string> {
  // Com override o token é da EMPRESA e vem do banco de quem chamou — não há
  // o que resolver aqui, e nem se deve ir ao `config_focus` por engano.
  const token = tokenOverride ?? (await obterTokenFocus(ambiente));
  if (!token) {
    // A mensagem DIZ QUAL AMBIENTE falta e ONDE AGIR. A anterior era
    // "FOCUS_NFE_TOKEN não configurado": tecnicamente certa, e mesmo assim
    // muda — quem a lesse não teria como saber onde a variável deveria estar
    // nem qual dos dois tokens era o que faltava.
    throw new Error(
      `Token de ${ambiente === 'hom' ? 'homologação' : 'produção'} da Focus não configurado — ` +
      'preencha em /admin/configuracoes/focus.',
    );
  }
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
  tokenOverride?: string,
): Promise<T> {
  // Resolvido UMA vez, fora do laço: a credencial não muda entre tentativas, e
  // dentro do `try` a falta de token seria capturada como se fosse erro de rede
  // e ainda tentaria mais duas vezes antes de contar a verdade. `env` já é o
  // ambiente que a URL abaixo vai de fato usar (`base(env)`) — é o mesmo que
  // `auth` precisa para resolver o token certo.
  const authorization = await auth(env, tokenOverride);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base(env)}${path}`, {
        method,
        headers: {
          Authorization: authorization,
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
  /** GET /v2/cnpjs/:cnpj — consulta dados de empresa (só cnae_principal; sem secundários) */
  consultarCnpj: (cnpj: string, env: FocusEnv = 'prod') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/cnpjs/${cnpj}`),

  /**
   * GET /v2/codigos_cnae/:codigo — consulta um CNAE no catálogo (código, descrição, hierarquia).
   *
   * `tokenOverride` aceito pela mesma razão de `consultarEmpresa`: é o
   * endpoint que `lib/fiscal/focus-token-sonda.ts` usa para testar um token
   * CANDIDATO (do formulário de `admin/configuracoes/focus`) antes de gravar,
   * sem esperar o que já está no banco.
   */
  consultarCnae: (codigo: string, env: FocusEnv = 'prod', tokenOverride?: string) =>
    call<Record<string, unknown>>(env, 'GET', `/v2/codigos_cnae/${codigo}`, undefined, tokenOverride),

  /**
   * GET /v2/codigos_cnae?... — busca/lista CNAEs no catálogo (paginado, até 50/req).
   * Filtros: codigo, descricao, secao, divisao, grupo, classe, subclasse, offset.
   */
  listarCnaes: (filtros: Record<string, string | number> = {}, env: FocusEnv = 'prod') => {
    const qs = new URLSearchParams(
      Object.entries(filtros)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return call<Array<Record<string, unknown>>>(env, 'GET', `/v2/codigos_cnae${qs ? `?${qs}` : ''}`);
  },

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
   *
   * `tokenOverride` aceito para a sonda de `admin/configuracoes/focus`: testar
   * o token ANTES de gravar exige chamar com o candidato do formulário, e não
   * com o que `obterTokenFocus` leria do banco (que ainda é o antigo).
   */
  consultarEmpresa: (id: number, _env: FocusEnv = 'hom', tokenOverride?: string) =>
    call<FocusEmpresaSnapshot>('prod', 'GET', `/v2/empresas/${id}`, undefined, tokenOverride),

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
  //
  // Emissão exige o `token` da EMPRESA (vem do POST /v2/empresas e mora em
  // `companies.focus_token`), NÃO o token de revenda. Daí `empresaToken` ser
  // obrigatório nesses métodos. Quando esquecemos, a Focus retorna 401
  // "HTTP Basic: Access denied" (descoberto em 2026-05-28).
  //
  /** POST /v2/nfe?ref=:ref — emissão NFe (idempotente por ref) */
  emitirNfe: (ref: string, payload: unknown, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfe?ref=${encodeURIComponent(ref)}`, payload, empresaToken),
  /** POST /v2/nfce?ref=:ref */
  emitirNfce: (ref: string, payload: unknown, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload, empresaToken),
  /** POST /v2/nfsen?ref=:ref (NFSe Nacional / DPS) */
  emitirNfse: (ref: string, payload: unknown, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'POST', `/v2/nfsen?ref=${encodeURIComponent(ref)}`, payload, empresaToken),

  // ---------- Status (polling) ----------
  /** GET /v2/nfe/:ref — consulta status da NFe */
  consultarStatusNfe: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}`, undefined, empresaToken),
  /** GET /v2/nfce/:ref */
  consultarStatusNfce: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}`, undefined, empresaToken),
  /** GET /v2/nfsen/:ref */
  consultarStatusNfse: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<Record<string, unknown>>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}`, undefined, empresaToken),

  // ---------- Download (binário/texto) — também exigem o token da empresa ----------
  /** GET /v2/nfe/:ref.pdf → DANFE em PDF (ArrayBuffer) */
  baixarDanfe: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}.pdf`, undefined, empresaToken),
  /** GET /v2/nfe/:ref.xml → XML da NFe (string) */
  baixarXmlNfe: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfe/${encodeURIComponent(ref)}.xml`, undefined, empresaToken),
  /** GET /v2/nfce/:ref.pdf */
  baixarDanfeNfce: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}.pdf`, undefined, empresaToken),
  /** GET /v2/nfce/:ref.xml */
  baixarXmlNfce: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfce/${encodeURIComponent(ref)}.xml`, undefined, empresaToken),
  /** GET /v2/nfsen/:ref.pdf */
  baixarDanfeNfse: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<BinaryResponse>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}.pdf`, undefined, empresaToken),
  /** GET /v2/nfsen/:ref.xml */
  baixarXmlNfse: (ref: string, empresaToken: string, env: FocusEnv = 'hom') =>
    call<TextResponse>(env, 'GET', `/v2/nfsen/${encodeURIComponent(ref)}.xml`, undefined, empresaToken),

  // ---------- Cancelamento — também usa token da empresa ----------
  /**
   * DELETE /v2/nfe/:ref — cancelar (justificativa mínima 15 chars por regra SEFAZ).
   * Valida ANTES do fetch.
   */
  cancelarNfe: (ref: string, justificativa: string, empresaToken: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres (regra SEFAZ).');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfe/${encodeURIComponent(ref)}`,
      { justificativa },
      empresaToken,
    );
  },
  /** DELETE /v2/nfce/:ref */
  cancelarNfce: (ref: string, justificativa: string, empresaToken: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres (regra SEFAZ).');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfce/${encodeURIComponent(ref)}`,
      { justificativa },
      empresaToken,
    );
  },
  /** DELETE /v2/nfsen/:ref */
  cancelarNfse: (ref: string, justificativa: string, empresaToken: string, env: FocusEnv = 'hom') => {
    if (!justificativa || justificativa.trim().length < 15) {
      throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres.');
    }
    return call<Record<string, unknown>>(
      env,
      'DELETE',
      `/v2/nfsen/${encodeURIComponent(ref)}`,
      { justificativa },
      empresaToken,
    );
  },
};
