// Reconhece uma mensagem que é SÓ cumprimento — "olá", "bom dia", "oi, tudo bem?".
//
// POR QUE EXISTE (24/08/2026). O webhook cala de propósito diante de mensagem
// de número desconhecido que não é pergunta nem tem termo fiscal: é a guarda
// do incidente de 12/08, em que o "bom dia" de um conhecido do dono do número
// virava atendimento automático. A guarda está certa sobre o que ela queria
// impedir — resposta FISCAL a quem não perguntou nada — e errada sobre o
// cumprimento em si: número de empresa que recebe "olá" e fica mudo parece
// número errado.
//
// A saída não é afrouxar a guarda, é reconhecer o cumprimento e responder com
// a apresentação — sem IA, sem conteúdo fiscal, sem escalar para ninguém.
// Quem só disse "oi" recebe "oi" de volta e um convite a perguntar.

/** Tira acento, caixa e pontuação — só para COMPARAR, nunca para exibir. */
function normalizar(v: string): string {
  return v
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// As aberturas que uma pessoa usa sozinhas. `tudo bem` e `tudo bom` entram
// porque vêm coladas nelas ("oi, tudo bem?") e, sozinhas, ainda são só
// cumprimento.
const ABERTURAS = [
  'ola', 'oi', 'oie', 'opa', 'eae', 'e ai', 'salve',
  'bom dia', 'boa tarde', 'boa noite',
  'tudo bem', 'tudo bom', 'como vai', 'como voce esta', 'como esta',
];

// Ruído que costuma acompanhar sem mudar a natureza da mensagem.
const RECHEIO = ['por favor', 'pfv', 'pf', 'obrigado', 'obrigada', 'com licenca', 'boa'];

/**
 * `true` quando a mensagem é APENAS cumprimento — nada mais.
 *
 * O critério é subtrativo de propósito: tira do texto tudo que é abertura
 * conhecida e, se não sobrar nada, era só cumprimento. Uma lista de frases
 * inteiras ("ola tudo bem", "oi bom dia", …) nunca daria conta das combinações,
 * e um `startsWith('ola')` classificaria "olá, preciso abrir um MEI" como
 * cumprimento — justamente a mensagem que PRECISA da resposta completa.
 */
export function ehSoCumprimento(texto: string): boolean {
  let resto = normalizar(texto);
  if (!resto) return false;
  // Mensagem longa não é cumprimento, por mais que comece com um.
  if (resto.length > 60) return false;

  // Do mais longo para o mais curto: senão 'oi' consome o começo de 'oie' e
  // sobra 'e', que não casa com nada e derruba a classificação.
  const termos = [...ABERTURAS, ...RECHEIO].sort((a, b) => b.length - a.length);
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
