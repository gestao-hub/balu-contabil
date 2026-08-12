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
  const termoSolto = /^\s*[\w\sÀ-ÿ-]{0,40}\??\s*$/.test(t)
    && /\b(das|mei|dasn|defis|simples|nacional|inss|iss|iof|ipi|icms|imposto|tributo|nota fiscal|cnpj|cnae|aliquota|alíquota|anexo|fator r)\b/i.test(t);
  return termoSolto ? 'geral' : 'especifica';
}
