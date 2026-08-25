// Reconhece uma mensagem que é SÓ agradecimento — "obrigado", "ok obrigado",
// "muito obrigado, ajudou demais".
//
// POR QUE EXISTE (25/08/2026). Pedido do usuário depois do teste de ponta a
// ponta: quando a pessoa agradece, o assistente responde ao agradecimento e,
// se não houver mais nada em 5 minutos, encerra o atendimento com uma despedida.
// Este arquivo decide o "quando" — só o agradecimento arma esse relógio.
//
// A régua é a MESMA de `ehSoCumprimento`, e de propósito: subtração, não lista
// de frases. Mas com uma exigência a mais — precisa SOBRAR NADA **e** precisa
// TER havido um agradecimento. Sem a segunda parte, "ok" sozinho armaria o
// encerramento, e "ok" é reconhecimento de recebimento, não fim de conversa:
// muita gente escreve "ok" e emenda a próxima pergunta.

/** Tira acento, caixa e pontuação — só para COMPARAR, nunca para exibir. */
function normalizar(v: string): string {
  return v
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** O agradecimento em si. Pelo menos UM destes tem de aparecer. */
const AGRADECIMENTOS = [
  'muito obrigado', 'muito obrigada',
  'obrigado', 'obrigada', 'obrigadao', 'brigado', 'brigada',
  'agradeco', 'agradecido', 'agradecida', 'grato', 'grata', 'gratidao',
  'obg', 'obgd', 'vlw', 'valeu', 'tks', 'thanks',
];

// O que costuma vir colado num agradecimento sem mudar a natureza dele. Fica
// separado das ABERTURAS de `saudacao.ts` porque a lista é outra: aqui entram
// os fechamentos ("era isso", "ate mais") que num cumprimento não fariam sentido.
const RECHEIO = [
  'ok', 'okay', 'blz', 'beleza', 'certo', 'tudo certo', 'ta certo', 'ta bom', 'ta',
  'muito', 'mto', 'demais', 'mesmo', 'entao', 'ai', 'sim',
  'entendi', 'entendido', 'perfeito', 'otimo', 'otima', 'show', 'legal', 'top', 'maravilha',
  'ajudou', 'me ajudou', 'ajudou muito', 'era isso', 'so isso', 'e isso',
  'por enquanto', 'por hora', 'por agora',
  'ate mais', 'ate logo', 'ate', 'tchau', 'abraco', 'abracos', 'falou',
  'bom', 'boa', 'boa noite', 'bom dia', 'boa tarde',
  'pela ajuda', 'pela atencao', 'pelas informacoes', 'pela informacao', 'pelo atendimento',
];

/**
 * `true` quando a mensagem é APENAS agradecimento — nada mais.
 *
 * Os dois lados importam:
 *
 * - **Sobrar algo derruba.** "obrigado, mas ainda tenho uma dúvida" NÃO é
 *   despedida — é agradecimento seguido de pergunta, e encerrar ali deixaria a
 *   pessoa falando sozinha. É o mesmo cuidado que impede `ehSoCumprimento` de
 *   classificar "olá, preciso abrir um MEI" como cumprimento.
 * - **Não ter agradecimento derruba.** "ok", "blz", "entendi" sozinhos casariam
 *   com o resto da subtração e armariam o encerramento de uma conversa que a
 *   pessoa só pausou para ler.
 */
export function ehAgradecimento(texto: string): boolean {
  const original = normalizar(texto);
  if (!original) return false;
  // Mensagem longa não é despedida, por mais que comece com "obrigado".
  if (original.length > 60) return false;

  const temAgradecimento = AGRADECIMENTOS.some(
    (t) => new RegExp(`(^| )${t}( |$)`).test(original),
  );
  if (!temAgradecimento) return false;

  // Do mais longo para o mais curto: senão 'ate' consome o começo de
  // 'ate mais' e sobra 'mais', que não casa com nada e derruba a classificação.
  // Mesmo motivo do `sort` em `ehSoCumprimento`.
  const termos = [...AGRADECIMENTOS, ...RECHEIO].sort((a, b) => b.length - a.length);
  let resto = original;
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const t of termos) {
      const antes = resto;
      resto = resto.replace(new RegExp(`(^| )${t}( |$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
      if (resto !== antes) mudou = true;
    }
  }
  return resto.length === 0;
}

/**
 * Quantos minutos de silêncio, depois de um agradecimento respondido, antes de
 * o assistente se despedir e encerrar.
 *
 * 5 minutos: decisão do usuário em 25/08/2026. Não há número certo aqui, há um
 * número explícito — e este é o lugar de mudá-lo.
 */
export const MINUTOS_ATE_ENCERRAR = 5;

/** A despedida. Constante porque o que é ENVIADO e o que é GRAVADO em
 *  `resposta_enviada` não podem divergir. */
export const TEXTO_ENCERRAMENTO =
  'Obrigado pelo contato! Fico à disposição sempre que precisar. 👋';
