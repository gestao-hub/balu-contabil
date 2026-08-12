// Termos de busca a partir de uma pergunta escrita pelo cliente.
//
// A busca da base jurídica (`buscarContextoJuridico`) parte de uma
// `SituacaoFiscal` tipada — o caminho do Bloco 6A, onde o app sabe de antemão
// do que se trata. No atendimento por WhatsApp não existe essa estrutura: o
// que chega é frase solta ("preciso do das deste mês", "por que aumentou?").
//
// Este módulo extrai da frase os termos que valem consulta. Determinístico e
// puro: a IA não escolhe o que buscar — se escolhesse, poderia "pesquisar"
// algo que ela mesma inventou.

/** Palavras que aparecem em qualquer frase e não discriminam nada. */
const VAZIAS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
  'nos', 'nas', 'por', 'para', 'pra', 'com', 'sem', 'que', 'qual', 'quais', 'quanto',
  'quando', 'como', 'onde', 'meu', 'minha', 'meus', 'minhas', 'eu', 'me', 'mim', 'você',
  'voce', 'ele', 'ela', 'isso', 'esse', 'essa', 'este', 'esta', 'aquele', 'aquela',
  'ser', 'estar', 'ter', 'tem', 'foi', 'era', 'está', 'esta', 'preciso', 'quero',
  'gostaria', 'poderia', 'pode', 'favor', 'obrigado', 'obrigada', 'bom', 'boa', 'dia',
  'tarde', 'noite', 'oi', 'olá', 'ola', 'e', 'ou', 'mas', 'se', 'já', 'ja', 'ainda',
  'mais', 'menos', 'muito', 'pouco', 'agora', 'hoje', 'ontem', 'amanhã', 'amanha',
  'mês', 'mes', 'ano', 'sobre', 'ao', 'à', 'às', 'aos', 'não', 'nao', 'sim',
]);

/** Termos do domínio que valem consulta mesmo curtos ou soltos na frase. */
const RELEVANTES = new Set([
  'das', 'mei', 'dasn', 'defis', 'simples', 'nacional', 'pgdas', 'inss', 'iss', 'icms',
  'nota', 'fiscal', 'nfse', 'nfe', 'cnpj', 'cnae', 'anexo', 'aliquota', 'alíquota',
  'imposto', 'tributo', 'guia', 'boleto', 'vencimento', 'multa', 'juros', 'parcelamento',
  'faturamento', 'limite', 'teto', 'desenquadramento', 'declaração', 'declaracao',
  'certificado', 'procuração', 'procuracao', 'baixa', 'abertura', 'socio', 'sócio',
  'pró-labore', 'prolabore', 'folha', 'funcionário', 'funcionario', 'atraso',
]);

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Termos de busca, em ordem de relevância: primeiro os do domínio fiscal,
 * depois as demais palavras significativas.
 *
 * Devolve lista vazia quando a frase não tem nada pesquisável ("oi", "bom
 * dia") — e isso é resposta legítima: buscar a base inteira por "oi" traria
 * ruído e gastaria contexto do modelo com texto irrelevante.
 */
export function termosDaPergunta(pergunta: string, maximo = 6): string[] {
  const palavras = String(pergunta ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const doDominio: string[] = [];
  const outras: string[] = [];

  for (const p of palavras) {
    const limpa = semAcento(p);
    if (RELEVANTES.has(p) || RELEVANTES.has(limpa)) {
      if (!doDominio.includes(p)) doDominio.push(p);
      continue;
    }
    // Palavra comum só entra se for longa o bastante para significar algo.
    if (p.length >= 5 && !VAZIAS.has(p) && !VAZIAS.has(limpa) && !outras.includes(p)) {
      outras.push(p);
    }
  }

  return [...doDominio, ...outras].slice(0, maximo);
}
