// Bloco 4B — traducao das recusas do Asaas na criacao da subconta.
//
// POR QUE ESTE MODULO EXISTE
// `validarDadosSubconta` (subconta.ts) NAO valida digito verificador de
// CPF/CNPJ de proposito: quem sabe se o documento existe e a Receita, e o
// Asaas ja consulta. A aposta so fecha se a recusa do Asaas chegar ao
// escritorio em portugues e acionavel — senao o "erro cru em ingles" que
// aquele modulo existe para evitar vaza exatamente no caso que escolhemos
// nao validar.
//
// REGRA DE OURO: nada do texto de entrada sai daqui. O corpo de erro do
// Asaas pode conter dado do titular (nome, documento, e-mail) e esta string
// acaba na TELA. Toda saida e uma constante escrita a mao neste arquivo.
// Por isso a funcao decide por CASAMENTO e devolve mensagem propria — nunca
// interpola, nunca concatena, nunca ecoa trecho do erro.
//
// Puro e fora do `actions.ts` porque arquivo 'use server' so pode exportar
// funcao async — exportar funcao pura de la quebra no `next build`, que o
// `tsc --noEmit` nao pega.

const DOCUMENTO_DUPLICADO =
  'Já existe uma conta no Asaas com este CPF/CNPJ. Se ela é do seu escritório, fale com o suporte da Balu antes de tentar de novo.';
const DOCUMENTO_INVALIDO =
  'O Asaas recusou o CPF/CNPJ informado. Confira os dígitos e tente de novo.';
const EMAIL_INVALIDO =
  'O Asaas recusou o e-mail informado. Confira o endereço — ele precisa ser um e-mail em uso.';
const CEP_INVALIDO =
  'O Asaas recusou o CEP informado. Confira o CEP com 8 dígitos.';
const ENDERECO_INVALIDO =
  'O Asaas recusou o endereço informado. Confira rua, número e bairro.';
const TELEFONE_INVALIDO =
  'O Asaas recusou o celular informado. Informe um celular com DDD.';
const NASCIMENTO_INVALIDO =
  'O Asaas recusou a data de nascimento. Confira a data do responsável.';
const TIPO_EMPRESA_INVALIDO =
  'O Asaas recusou o tipo da empresa. Confira se ele corresponde ao CNPJ informado.';
const FATURAMENTO_INVALIDO =
  'O Asaas recusou o faturamento mensal informado. Informe um valor realista.';
const NOME_INVALIDO =
  'O Asaas recusou o nome informado. Use a razão social completa do escritório.';
const AUTENTICACAO =
  'A Balu não conseguiu se autenticar no Asaas. Isso é problema nosso — fale com o suporte da Balu.';
const INDISPONIVEL =
  'O Asaas não respondeu agora. Espere alguns minutos e tente de novo.';
const GENERICO =
  'O Asaas recusou os dados do cadastro. Confira documento, e-mail, CEP, telefone e endereço.';

type Regra = { quando: RegExp; mensagem: string };

/**
 * Status HTTP do formato que `call` (clients/asaas.ts) monta:
 * `Asaas POST /v3/accounts → 400: <corpo>`.
 *
 * Extraido do CABECALHO, nunca procurado no texto inteiro: o corpo de erro
 * traz numeros do proprio cadastro (faturamento 5000, CEP 01503000) e um
 * `/\b500\b//` solto sobre a string toda transformaria "faturamento invalido"
 * em "o Asaas nao respondeu".
 */
function statusHttp(bruto: string): number | null {
  const m = /→\s*(\d{3}):/.exec(bruto);
  return m ? Number(m[1]) : null;
}

/**
 * Status HTTP de um erro vindo do cliente Asaas — ou `null` quando NAO HOUVE
 * resposta (timeout, DNS, conexao cortada, corpo ilegivel).
 *
 * Essa diferenca decide dinheiro na criacao da subconta: com status 4xx o
 * Asaas RECUSOU o pedido e nada foi criado; sem status (ou com 5xx) ninguem
 * sabe se a subconta nasceu do outro lado — e ai a criacao tem de virar
 * registro de auditoria para busca manual.
 *
 * Le o campo `status` que `call` anexa ao erro (clients/asaas.ts) e so cai no
 * texto para erro que veio de outro caminho — a mesma extracao de cabecalho de
 * `statusHttp`, sem duplicar o regex.
 */
export function statusDoErroAsaas(erro: unknown): number | null {
  const anexado = (erro as { status?: unknown } | null | undefined)?.status;
  if (typeof anexado === 'number' && Number.isFinite(anexado)) return anexado;
  return statusHttp(erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : '');
}

// A ORDEM IMPORTA. "ja existe ... CPF/CNPJ" tambem casa com a regra de
// documento invalido; se a duplicidade nao vier primeiro, o escritorio recebe
// "confira os digitos" para um documento que esta certo — e tenta de novo
// para sempre.
const REGRAS: Regra[] = [
  { quando: /unauthorized|forbidden|access ?denied|invalid[ _-]?(api[ _-]?key|token)|n[aã]o configurado/i, mensagem: AUTENTICACAO },
  { quando: /too many requests|timeout|etimedout|econnreset|enotfound|fetch failed|falhou ap[oó]s|socket hang up/i, mensagem: INDISPONIVEL },
  { quando: /already[ _-]?(exists|registered|in use)|already been|j[aá] (existe|est[aá] (em uso|cadastrad)|cadastrad|utilizad)|duplicat/i, mensagem: DOCUMENTO_DUPLICADO },
  { quando: /cpf ?_?cnpj|\bcpf\b|\bcnpj\b|documento/i, mensagem: DOCUMENTO_INVALIDO },
  { quando: /e-?mail/i, mensagem: EMAIL_INVALIDO },
  { quando: /postal ?_?code|\bcep\b|zip ?_?code/i, mensagem: CEP_INVALIDO },
  { quando: /mobile ?_?phone|\bphone\b|telefone|celular/i, mensagem: TELEFONE_INVALIDO },
  { quando: /birth ?_?date|nascimento/i, mensagem: NASCIMENTO_INVALIDO },
  { quando: /company ?_?type|tipo ?da ?empresa/i, mensagem: TIPO_EMPRESA_INVALIDO },
  { quando: /income ?_?value|faturamento|renda/i, mensagem: FATURAMENTO_INVALIDO },
  { quando: /address ?_?number|\baddress\b|province|endere[cç]o|bairro|logradouro/i, mensagem: ENDERECO_INVALIDO },
  { quando: /invalid ?_?name|\bname\b|\bnome\b|raz[aã]o social/i, mensagem: NOME_INVALIDO },
];

/**
 * Recusa do Asaas → mensagem em português que o escritório consegue agir.
 *
 * Aceita `unknown` porque quem chama esta num `catch`, onde o valor pode nao
 * ser `Error`. Sem match, cai no generico: melhor uma mensagem vaga em
 * portugues que o corpo cru do Asaas na tela.
 */
export function traduzirErroAsaas(erro: unknown): string {
  const bruto =
    erro instanceof Error ? erro.message
    : typeof erro === 'string' ? erro
    : '';
  if (!bruto) return GENERICO;

  // Classe do status antes do texto: 401/403 e 5xx nao sao culpa do dado
  // digitado, e mandar o escritorio "conferir o CPF" quando a chave da Balu
  // e que esta errada faz ele tentar de novo para sempre.
  const status = statusDoErroAsaas(erro);
  if (status === 401 || status === 403) return AUTENTICACAO;
  if (status === 429 || (status !== null && status >= 500)) return INDISPONIVEL;

  for (const r of REGRAS) {
    if (r.quando.test(bruto)) return r.mensagem;
  }
  return GENERICO;
}

/**
 * A DESCRICAO que o proprio Asaas devolveu, quando ela e util ao usuario.
 *
 * ─── POR QUE ISTO EXISTE (02/09/2026) ───────────────────────────────────────
 * O titular clicou em assinar e recebeu "Nao foi possivel concluir a assinatura
 * agora. Tente novamente." A criacao do CLIENTE tinha funcionado (o customer
 * existe no Asaas de producao); quem foi recusada foi a ASSINATURA, e o motivo
 * — que o Asaas manda por escrito, em portugues — morreu num `console.error`.
 * Resultado: a pessoa repetiu um clique que nunca ia funcionar, exatamente o
 * modo de falha que o comentario de `assinar.ts` ja descrevia para outro caso.
 *
 * `traduzirErroAsaas` nao resolvia: as REGRAS acima sao afinadas para SUBCONTA
 * (documento, CEP, telefone) e um erro de valor cai no generico igual.
 *
 * ─── POR QUE MOSTRAR O TEXTO DO ASAAS, SE A REGRA DA CASA E NAO MOSTRAR ─────
 * A regra e nao vazar o CORPO CRU (que traz metodo, rota, status e JSON). A
 * `description` e outra coisa: uma frase em portugues escrita para o usuario
 * final ("O valor da cobranca nao pode ser menor que R$ 5,00"). Preferir uma
 * mensagem vaga nossa a uma frase precisa deles seria escolher o silencio.
 *
 * Devolve `null` quando nao ha descricao aproveitavel — e ai quem chama usa o
 * generico de sempre. Nunca devolve o corpo inteiro, nunca devolve URL, nunca
 * devolve nada de 5xx/401 (esses nao sao acionaveis por quem esta na tela).
 */
export function descricaoDoErroAsaas(erro: unknown): string | null {
  const status = statusDoErroAsaas(erro);
  // 4xx de validacao e o unico caso em que a frase do Asaas ajuda quem clicou.
  if (status === null || status < 400 || status >= 500) return null;
  if (status === 401 || status === 403) return null;

  const bruto = erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : '';
  const inicio = bruto.indexOf('{');
  if (inicio < 0) return null;
  try {
    const corpo = JSON.parse(bruto.slice(inicio)) as { errors?: Array<{ description?: unknown }> };
    const d = corpo.errors?.[0]?.description;
    if (typeof d !== 'string') return null;
    const limpo = d.trim();
    // Descartar o que nao e frase: vazio, ou longo demais para caber numa
    // mensagem de tela sem virar despejo.
    if (limpo.length === 0 || limpo.length > 200) return null;
    return limpo;
  } catch {
    return null;
  }
}

/** Só para o teste provar que nenhuma saída vaza texto de entrada. */
export const MENSAGENS_SUBCONTA = [
  DOCUMENTO_DUPLICADO, DOCUMENTO_INVALIDO, EMAIL_INVALIDO, CEP_INVALIDO,
  ENDERECO_INVALIDO, TELEFONE_INVALIDO, NASCIMENTO_INVALIDO,
  TIPO_EMPRESA_INVALIDO, FATURAMENTO_INVALIDO, NOME_INVALIDO,
  AUTENTICACAO, INDISPONIVEL, GENERICO,
] as const;
