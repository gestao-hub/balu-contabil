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

/**
 * `semRetry`: UMA tentativa e mais nenhuma.
 *
 * O retry deste cliente pressupoe chamada idempotente — repetir um GET, ou um
 * POST cuja repeticao o Asaas trata como a mesma cobranca, no maximo custa
 * tempo. `POST /v3/accounts` quebra as duas premissas ao mesmo tempo: cria
 * pessoa juridica nova a cada chamada E devolve a `apiKey` UMA UNICA VEZ. Um
 * 504 do gateway depois da subconta ja criada faz o retry ou criar uma
 * SEGUNDA subconta, ou bater em "documento duplicado" — nos dois casos a
 * primeira nasceu com a chave perdida, e ninguem consegue opera-la.
 *
 * Sem retry, a duvida continua existindo (o 504 pode ter chegado depois da
 * criacao), mas ela fica com UM candidato a subconta orfa em vez de dois, e
 * quem chama registra a duvida em auditoria. Ver
 * `criarSubcontaAction` (contador/configuracoes/subconta/actions.ts).
 */
type OpcoesCall = { semRetry?: boolean };

/** Erro de resposta HTTP do Asaas, com o status ANEXADO. Quem esta no `catch`
 *  precisa distinguir "o Asaas recusou o dado" (4xx — nada foi criado) de
 *  "nao sei o que aconteceu do outro lado" (5xx), e ler isso do texto da
 *  mensagem e mais fragil do que ler de um campo. Ver
 *  `statusDoErroAsaas` em `@/lib/billing/subconta-erros`. */
export type AsaasHttpError = Error & { status: number };

async function call<T>(
  method: string, path: string, body?: unknown, token?: string, opts?: OpcoesCall,
): Promise<T> {
  const tentativas = opts?.semRetry ? 1 : MAX_RETRIES;
  let lastErr: unknown;
  for (let attempt = 0; attempt < tentativas; attempt++) {
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
        if (RETRYABLE.has(res.status) && attempt < tentativas - 1) {
          await sleep(BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        // Truncado de proposito: o corpo de erro do Asaas pode trazer dado
        // do cliente, e esta mensagem acaba em log.
        const txt = (await res.text()).slice(0, 500);
        const err = new Error(`Asaas ${method} ${path} → ${res.status}: ${txt}`) as AsaasHttpError;
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || /timeout|ETIMEDOUT|ECONNRESET/i.test(err.message));
      if (isTimeout && attempt < tentativas - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Asaas ${method} ${path} → falhou apos ${tentativas} tentativas`);
}

export type AsaasCliente = { id: string; name: string; cpfCnpj: string };
export type AsaasAssinatura = {
  id: string; customer: string; value: number; cycle: string;
  status: string; nextDueDate: string;
};
export type AsaasCobranca = {
  id: string; subscription?: string; value: number; dueDate: string;
  status: string; invoiceUrl?: string; billingType?: string;
  /** Quando o dinheiro entrou. Levantado contra o sandbox em 28/07: o item da
   *  LISTA (`GET /v3/payments`) traz os dois campos, iguais aos do corpo do
   *  webhook — por isso a reconciliacao consegue reusar a mesma escrita.
   *  `confirmedDate` importa porque em CONFIRMED (cartao/Pix confirmado, ainda
   *  nao liquidado) o `paymentDate` vem nulo. */
  paymentDate?: string | null;
  confirmedDate?: string | null;
  /** `<contabilidadeId>:<clienteId>`, escrito por `emitir-cobranca.ts`. NAO
   *  serve para decidir DONO (e campo que o remetente escolhe, e por isso o
   *  roteamento do webhook o rejeitou) — serve para RECONHECER como nossa uma
   *  cobranca que ja esta na conta certa, que e outra pergunta. */
  externalReference?: string | null;
};

/** Envelope das listas paginadas do Asaas — observado em `GET /v3/payments`:
 *  `{ object, hasMore, totalCount, limit, offset, data }`. `hasMore` e o que
 *  permite varrer ate o fim sem depender de conhecer a ordenacao. */
export type ListaAsaas<T> = {
  data: T[];
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
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

/**
 * Um webhook cadastrado NA CONTA DO TOKEN (`GET /v3/webhooks`).
 *
 * Levantado contra o sandbox em 28/07, nao contra a doc. O item devolvido pela
 * LISTA e pelo GET por id e:
 *   {"id","name","url","email","enabled","interrupted","apiVersion":3,
 *    "hasAuthToken":true,"sendType","penalizedRequestsCount":0,"events":[…]}
 *
 * ⚠️ `hasAuthToken` NAO SERVE DE DIAGNOSTICO. Quando o POST vai SEM `authToken`,
 * o Asaas GERA um (observado: `whsec_…`) e devolve `hasAuthToken: true` do mesmo
 * jeito. Ou seja: um webhook cadastrado a mao no painel tem `hasAuthToken: true`
 * com um segredo que a Balu nao conhece, e toda entrega dele morre no
 * `unauthorized` da nossa rota — indistinguivel, na leitura, de um webhook sadio.
 * O segredo NUNCA volta na leitura (so no corpo do POST/PUT). Por isso o unico
 * conserto possivel e reescrever por PUT; ver `webhook-subconta.ts`.
 */
export type AsaasWebhook = {
  id: string;
  name: string;
  url: string;
  email?: string;
  enabled: boolean;
  interrupted: boolean;
  hasAuthToken: boolean;
  sendType: string;
  /** Quantas entregas o Asaas ja penalizou. > 0 = ele esta falhando em entregar. */
  penalizedRequestsCount?: number;
  events: string[];
};

/**
 * Corpo de `POST`/`PUT /v3/webhooks`. TODOS os campos abaixo sao OBRIGATORIOS —
 * levantado campo a campo contra o sandbox, mandando corpo incompleto ate a
 * validacao se declarar:
 *   sem `events` → "É necessário informar no mínimo um evento…"
 *   sem `name`   → "É necessário informar um nome…"
 *   sem `sendType` → "É necessário informar um tipo de envio…"
 *   sem `email`/`enabled`/`url` → "O parâmetro X deve ser informado"
 *   `interrupted` satisfaz o pedido de `poolInterrupted` (o erro cita o segundo
 *   nome, o primeiro e aceito).
 *
 * `authToken` e opcional PARA O ASAAS — e e justamente por isso que ele nunca
 * pode faltar aqui (ver o aviso em `AsaasWebhook`). Minimo de 32 caracteres,
 * tambem observado: "O token deve ter pelo menos 32 caracteres."
 */
export type PayloadWebhook = {
  name: string;
  url: string;
  email: string;
  enabled: boolean;
  interrupted: boolean;
  sendType: 'SEQUENTIALLY' | 'NON_SEQUENTIALLY';
  authToken: string;
  events: readonly string[];
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
  /**
   * SEM RETRY, de propósito (ver `OpcoesCall` acima). É a única chamada do
   * cliente que não é idempotente E cuja resposta traz um segredo que só
   * aparece uma vez. Repetir aqui é criar subconta a mais com chave perdida.
   */
  criarSubconta: (d: Record<string, unknown>) =>
    call<AsaasSubconta>('POST', '/v3/accounts', d, undefined, { semRetry: true }),
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

    /**
     * Clientes JA cadastrados na subconta, filtrados pelo documento.
     *
     * Existe para nao criar um cadastro novo a cada emissao: `POST /v3/customers`
     * NAO deduplica, e um honorario mensal viraria doze "clientes" iguais na
     * agenda do escritorio — que e a agenda DELE, nao da Balu. Quem chama
     * confere o documento devolvido antes de reusar (ver `emitir-cobranca.ts`):
     * se o filtro do Asaas mudar de nome, o pior caso volta a ser o de hoje,
     * criar um cadastro novo, e nunca cobrar a pessoa errada.
     */
    buscarClientesPorDocumento: (cpfCnpj: string) =>
      call<{ data: AsaasCliente[] }>(
        'GET', `/v3/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=10`, undefined, token,
      ),

    criarCobranca: (d: {
      customer: string; billingType: 'BOLETO' | 'PIX' | 'UNDEFINED';
      value: number; dueDate: string; description?: string; externalReference?: string;
    }) => call<AsaasCobranca>('POST', '/v3/payments', d, token),

    consultarCobranca: (id: string) =>
      call<AsaasCobranca>('GET', `/v3/payments/${id}`, undefined, token),

    /**
     * Cobrancas DA PROPRIA SUBCONTA, uma pagina por chamada.
     *
     * PAGINA de proposito, em vez de ler so as 100 primeiras: a reconciliacao
     * diaria (lib/billing/cron.ts) e a rede de seguranca para o webhook que nao
     * chegou, e uma janela fixa transformaria essa rede num buraco silencioso
     * assim que o escritorio passasse de 100 cobrancas — justo o escritorio com
     * mais dinheiro em jogo. O `hasMore` do envelope diz quando parar, e por
     * isso NAO e preciso conhecer a ordenacao padrao do Asaas.
     *
     * ORDEM EXPLICITA (`sort=dateCreated&order=desc`), e nao por confiar no
     * default. O `hasMore` torna a ordem irrelevante para uma varredura que roda
     * ATE O FIM — mas so para essa. No dia em que o teto de paginas (ou um
     * timeout) cortar a varredura no meio, e a ORDEM que decide qual ponta fica
     * de fora. Com `desc`, o que se perde sao as mais ANTIGAS, ja liquidadas;
     * sem a clausula, quem decide isso e um default nao documentado do Asaas.
     * Sondado no sandbox: `order` e honrado de verdade (asc devolve exatamente o
     * inverso de desc), e o default hoje ja e desc — o que nao e promessa.
     *
     * ⚠️ NAO ha filtro de status aqui, e nao e esquecimento: o Asaas IGNORA EM
     * SILENCIO um parametro que nao conhece (provado no sandbox — `status=BANANA`
     * devolveu a lista inteira, HTTP 200). Um filtro com erro de digitacao nao
     * falha: ele varre tudo parecendo que filtrou. Como a varredura completa e o
     * que queremos mesmo, nao ha por que correr o risco. (Foi esse mesmo achado
     * que obrigou a PROVAR o `order` acima em vez de assumi-lo.)
     */
    listarCobrancas: (offset = 0) =>
      call<ListaAsaas<AsaasCobranca>>(
        'GET', `/v3/payments?limit=100&offset=${offset}&sort=dateCreated&order=desc`,
        undefined, token,
      ),

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

    /**
     * Webhooks DA PROPRIA SUBCONTA. Mesma logica de `consultarStatusConta`: a
     * rota e "os webhooks da conta do token". Sem o `, token` isto listaria (e
     * pior, cadastraria) na conta-mae — a Balu passaria a receber os eventos do
     * dinheiro do escritorio na sua propria conta, e a subconta continuaria
     * muda. Nao ha rota por subconta pela conta-mae.
     */
    listarWebhooks: () =>
      call<{ data: AsaasWebhook[] }>('GET', '/v3/webhooks?limit=100', undefined, token),

    /**
     * COM RETRY (ao contrario de `criarSubconta`). As duas premissas que faltavam
     * la valem aqui: nada de irrecuperavel volta no corpo — o `authToken` e um
     * segredo que NOS escolhemos e ja temos — e a repeticao e inofensiva porque
     * o proprio Asaas deduplica: um segundo POST com a MESMA `url` responde 400
     * "Já existe uma configuração para os eventos com os mesmos atributos"
     * (observado: nome diferente, subconjunto de eventos e outro `sendType` NAO
     * escapam da deduplicacao — a chave e so a url).
     *
     * ⚠️ O CORPO DA RESPOSTA DE SUCESSO TRAZ O `authToken` EM CLARO. E o unico
     * corpo do 4B com essa propriedade fora da criacao de subconta. Nao logue o
     * retorno; leia so o `.id`.
     */
    criarWebhook: (d: PayloadWebhook) =>
      call<AsaasWebhook>('POST', '/v3/webhooks', d, token),

    /**
     * REESCREVE um webhook existente. E o unico conserto possivel quando o
     * webhook da url da Balu esta no ar com o segredo ERRADO — estado que a
     * leitura nao consegue distinguir de saudavel (ver `AsaasWebhook`). Tambem
     * religa `enabled`, zera `interrupted` e recompoe a lista de eventos.
     *
     * Idempotente por construcao: manda sempre a MESMA forma canonica.
     * Mesma ressalva do `criarWebhook` quanto ao corpo da resposta.
     */
    atualizarWebhook: (id: string, d: PayloadWebhook) =>
      call<AsaasWebhook>('PUT', `/v3/webhooks/${id}`, d, token),
  };
}
