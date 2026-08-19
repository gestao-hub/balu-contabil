// Pergunta GERAL ou sobre A EMPRESA de quem escreve?
//
// A distinção decide o que fazer quando não há dado fiscal disponível:
//
//   • "como funciona o DAS?", "o que é IOF?", "MEI paga INSS?" — dúvida de
//     conhecimento geral. A base jurídica (documentos_juridicos, atualizada
//     diariamente pelo cron do RAG) responde sozinha. Escalar isso para o
//     contador é jogar trabalho humano num problema que o app resolve.
//
//   • "quanto EU pago?", "MINHA guia venceu?", "meu CNPJ está regular?" —
//     depende dos dados daquela empresa. Sem eles, responder é chutar, e a
//     regra do projeto é clara: na dúvida, o contador entra.
//
// Determinístico e puro — a classificação não pode depender do humor do
// modelo, porque é ela que decide quando um humano é acionado.

/** Marcas de que a pergunta é sobre a empresa de quem escreve. */
const PESSOAL = [
  /\bmeu[s]?\b/i, /\bminha[s]?\b/i, /\bda minha\b/i, /\bdo meu\b/i,
  /\beu (pago|devo|preciso|tenho|estou|posso|declaro|recebo)\b/i,
  /\bquanto (eu|que eu)\b/i, /\bpra mim\b/i, /\bpara mim\b/i,
  /\bmim\b/i, /\bcomigo\b/i,
  /\bminha empresa\b/i, /\bmeu cnpj\b/i, /\bminha guia\b/i, /\bmeu das\b/i,
  /\bestou (devendo|em dia|irregular|atrasado)\b/i,
];

/** Marcas de dúvida conceitual, que a base jurídica cobre. */
const CONCEITUAL = [
  /\bcomo funciona\b/i, /\bo que (é|e|significa)\b/i, /\bpara que serve\b/i,
  /\bqual (a |é a |e a )?diferença\b/i, /\bquando (se |deve |é |e )?(paga|declara|vence)\b/i,
  /\bquem (precisa|deve|paga|pode)\b/i, /\bpor que existe\b/i, /\bexplica[r]?\b/i,
  /\bo que acontece se\b/i, /\bé obrigat[óo]rio\b/i,
];

/**
 * Vocabulário fiscal reconhecido num TERMO SOLTO ("IPI", "regime tributário").
 *
 * Exportado porque o webhook usa a MESMA régua para decidir se uma mensagem de
 * número não cadastrado merece resposta ou silêncio — duas listas divergentes
 * fariam o assistente responder no ramo identificado e calar no outro, para a
 * mesma palavra.
 *
 * `\b` em toda sigla curta é obrigatório: sem ele `iss` casa dentro de "isso"
 * e "compromisso", e conversa fiada viraria dúvida fiscal.
 */
export const TERMO_FISCAL =
  /\b(das|mei|simei|dasn|defis|pgdas|simples|nacional|inss|iss|iof|ipi|icms|irpj|csll|pis|cofins|impostos?|tributos?|tribut[áa]ri[oa]s?|regimes?|notas? fiscais?|nota fiscal|nfe|nfse|nfce|cnpj|cnae|al[íi]quotas?|anexos?|fator r|faturamento|microempreendedor(es)?|declara\w*|guias?|contabilidade|contador)\b/i;

/**
 * A mensagem é uma PERGUNTA?
 *
 * Existe para o ramo do número não cadastrado, onde a régua de vocabulário
 * falhou em 19/08/2026: "quais os impostos que o governo cobra quando abro uma
 * empresa" ficou sem resposta porque `imposto` estava no singular e a frase
 * passava de 40 caracteres. Lista de palavras decide MAL o que é pergunta —
 * sempre vai existir um jeito novo de perguntar.
 *
 * Só o pronome interrogativo conta no início, nunca verbo: "pode ficar só
 * escutando" é conversa entre duas pessoas, não pergunta ao assistente — e foi
 * exatamente esse tipo de mensagem que gerou o incidente de 12/08/2026.
 */
export function pareceUmaPergunta(texto: string): boolean {
  const t = String(texto ?? '').trim();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /^(qual|quais|quanto[s]?|quanta[s]?|como|quando|onde|quem|por\s*que|porqu[êe]|pq|o\s*que|oq)\b/i.test(t);
}

/**
 * A pergunta é sobre a empresa de QUEM ESCREVE ("quanto é o MEU DAS?")?
 *
 * No ramo do número cadastrado, `classificarPergunta` já resolve. No ramo do
 * desconhecido o default dela ("na dúvida, específica") é o lado errado: sem
 * conta não existe resposta específica possível, então o único caso que merece
 * "não identificamos você" é o que fala explicitamente da própria empresa.
 */
export function temMarcaPessoal(texto: string): boolean {
  const t = String(texto ?? '');
  return PESSOAL.some((re) => re.test(t));
}

export type TipoPergunta = 'geral' | 'especifica';

/**
 * Na dúvida, `especifica`.
 *
 * Errar para "geral" faria o assistente responder sobre a empresa de alguém
 * com informação genérica — pior que pedir ajuda ao contador. Errar para
 * "especifica" só gera um encaminhamento a mais.
 */
export function classificarPergunta(texto: string): TipoPergunta {
  const t = String(texto ?? '');
  if (!t.trim()) return 'especifica';

  const pessoal = PESSOAL.some((re) => re.test(t));
  const conceitual = CONCEITUAL.some((re) => re.test(t));

  // "como funciona o MEU das?" tem os dois: o possessivo manda, porque a
  // resposta útil depende do dado dele.
  if (pessoal) return 'especifica';
  if (conceitual) return 'geral';

  // Sem marca de nenhum lado ("DAS", "limite do MEI", "IOF"): tratamos como
  // geral quando é claramente um TERMO fiscal solto, porque é assim que as
  // pessoas perguntam no WhatsApp — frases curtas.
  const termoSolto = /^\s*[\w\sÀ-ÿ-]{0,40}\??\s*$/.test(t) && TERMO_FISCAL.test(t);
  return termoSolto ? 'geral' : 'especifica';
}
