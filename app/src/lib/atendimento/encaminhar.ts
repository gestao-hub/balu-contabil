// Encaminhar o atendimento para um escritório HUMANO.
//
// POR QUE EXISTE (06/10/2026). Teste real no canal do Escritório Demo, número
// sem cadastro: "falar com o contador", "direcione para atendimento humano",
// "passe para o escritório demo" — sete pedidos seguidos, e a IA respondeu a
// todos com "o escritório X é o responsável e poderá te auxiliar", gravando
// `resolvido: true`. Nada chegou à fila do escritório: o ramo de número sem
// cadastro NÃO TINHA encaminhamento nenhum, e quem decidia se havia pedido de
// humano era o modelo.
//
// Mesma regra de `classificar.ts`: o que aciona um humano é decidido por
// CÓDIGO, nunca pelo humor do modelo. Puro, sem I/O.

function normalizar(v: string): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Com quem a pessoa quer falar. `escrit\w*` pega também "escrito" (erro real
 *  de digitação do teste de 06/10). */
const ALVO_HUMANO =
  /\b(contador(a|es)?|contabilidade|escrit\w*|atendente|humano|pessoa|algu[eé]m|equipe|suporte|responsavel)\b/;

/** O verbo do pedido. */
const VERBO_PEDIDO =
  /\b(falar|fala|conversar|atendimento|atender|passa\w*|passe|encaminh\w*|transfer\w*|direcion\w*|chama\w*|liga\w*|contato|quero|preciso|gostaria)\b/;

/** Frases que já são pedido sozinhas. */
const PEDIDO_DIRETO = [
  /\batendimento humano\b/,
  /\b(quero|preciso|gostaria de) (um |uma )?(atendente|humano|pessoa)\b/,
  /\bfalar com (um |uma |o |a )?(atendente|humano|pessoa|contador|contadora|escritorio|contabilidade)\b/,
];

/**
 * A mensagem PEDE um atendimento humano?
 *
 * Exige verbo de pedido + alvo humano na mesma mensagem: "o contador falou que
 * o DAS vence dia 20" tem o alvo e não tem pedido; "quero" sozinho tem o verbo
 * e não tem alvo. Errar para o "não" custa uma resposta da IA a mais; errar
 * para o "sim" põe na fila do escritório quem só fez uma pergunta.
 */
export function pedeAtendimentoHumano(texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  if (PEDIDO_DIRETO.some((re) => re.test(t))) return true;
  // Pergunta sobre o contador ("o que o contador faz?") não é pedido.
  if (/^(o que|qual|quais|como|quando|por que|porque)\b/.test(t)) return false;
  return ALVO_HUMANO.test(t) && VERBO_PEDIDO.test(t);
}

export type OpcaoEscritorio = { id: string; nome: string };

/** Quantos escritórios cabem numa mensagem de WhatsApp sem virar lista telefônica. */
export const MAX_OPCOES = 10;

/** A pergunta "para qual escritório?", com as opções numeradas. */
export function textoEscolhaEscritorio(opcoes: OpcaoEscritorio[]): string {
  const linhas = opcoes.slice(0, MAX_OPCOES).map((o, i) => `${i + 1}. ${o.nome}`);
  return [
    'Claro! Para qual escritório de contabilidade você quer ser direcionado?',
    '',
    ...linhas,
    '',
    'Responda com o número ou o nome do escritório.',
  ].join('\n');
}

/** Quando não há escritório nenhum para oferecer. */
export const TEXTO_SEM_ESCRITORIOS =
  'No momento não há escritório de contabilidade disponível para receber seu atendimento por aqui. '
  + 'Pode me contar sua dúvida que eu tento ajudar.';

/** Opção não reconhecida — repete a lista. */
export function textoOpcaoInvalida(opcoes: OpcaoEscritorio[]): string {
  return `Não identifiquei qual escritório você escolheu.\n\n${textoEscolhaEscritorio(opcoes)}`;
}

/** A confirmação de que o pedido FOI encaminhado — só é enviada depois de
 *  gravado, então a promessa é verdadeira. */
export function textoEncaminhado(nome: string, slaHoras: number | null): string {
  const prazo = slaHoras ? ` em até ${slaHoras} hora${slaHoras === 1 ? '' : 's'}` : ' assim que possível';
  return `Pronto! Encaminhei seu atendimento para a equipe do ${nome}. `
    + `Eles vão falar com você por aqui${prazo}.`;
}

/**
 * Qual das opções a pessoa escolheu — o id, ou `null` se não deu para saber.
 *
 * Aceita o NÚMERO da lista ("2", "opção 2", "o 2") e o NOME, inteiro ou parte
 * dele ("demo", "escritório teste"). Parte do nome que casa com mais de uma
 * opção é ambígua e devolve `null`: escolher por palpite manda o cliente para o
 * escritório errado.
 */
export function escolherEscritorio(texto: string, opcoes: OpcaoEscritorio[]): string | null {
  const t = normalizar(texto);
  if (!t || opcoes.length === 0) return null;

  const numero = t.match(/^(?:(?:opcao|opção|o|a|numero|n)\s*)?(\d{1,2})\b/);
  if (numero) {
    const i = Number(numero[1]) - 1;
    return i >= 0 && i < opcoes.length ? opcoes[i].id : null;
  }

  // Nome exato primeiro; depois "o texto contém o nome" ou "o nome contém o texto".
  const exato = opcoes.filter((o) => normalizar(o.nome) === t);
  if (exato.length === 1) return exato[0].id;

  // Palavras que não distinguem um escritório de outro ficam de fora.
  const VAZIAS = new Set(['escritorio', 'contabilidade', 'contabil', 'o', 'a', 'do', 'da', 'de', 'para', 'pro', 'pra', 'com', 'e']);
  const palavras = t.split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (palavras.length === 0) return null;
  const casam = opcoes.filter((o) => {
    const n = normalizar(o.nome);
    return n.includes(t) || palavras.every((p) => n.includes(p));
  });
  return casam.length === 1 ? casam[0].id : null;
}
