// Casamento de número de WhatsApp com o cadastro.
//
// Existe porque a comparação ingênua não funciona, e o modo de falhar é
// silencioso: o webhook responde "não conseguimos identificar sua conta" a um
// cliente que está cadastrado, e ninguém descobre sem ler log.
//
// Três diferenças de formato conspiram:
//
//  1. **O `+`**. O opt-in grava em E.164 (`+5532987006789`); a uazapi entrega
//     dígitos crus (`5532987006789`). Só isso já derruba todo `.eq()`.
//  2. **O sufixo de JID**. O identificador pode vir como
//     `5532987006789@s.whatsapp.net`.
//  3. **O nono dígito.** Celular brasileiro ganhou o 9 em 2012, mas o
//     WhatsApp mantém contas antigas com o número curto — a própria instância
//     do Balu, cujo telefone é (32) 99151-1415, aparece como `553291511415`,
//     sem o 9. Quem cadastrou com 9 e é identificado sem (ou o contrário)
//     nunca seria reconhecido.

/** Tira `+`, sufixo de JID e qualquer máscara. */
export function soDigitosWhatsapp(bruto: string | null | undefined): string {
  if (!bruto) return '';
  return String(bruto).split('@')[0].replace(/\D+/g, '');
}

/**
 * Todas as formas em que o MESMO celular pode estar gravado ou ser entregue.
 *
 * Para BR (55 + DDD + 8 ou 9 dígitos), devolve as duas variantes do nono
 * dígito. Fora disso, devolve só o que veio — inventar variação de numeração
 * estrangeira seria chutar.
 */
export function variantesDoNumero(bruto: string | null | undefined): string[] {
  const d = soDigitosWhatsapp(bruto);
  if (!d) return [];

  const fora = new Set<string>([d]);

  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    if (resto.length === 9 && resto.startsWith('9')) fora.add(`55${ddd}${resto.slice(1)}`);   // tira o 9
    if (resto.length === 8) fora.add(`55${ddd}9${resto}`);                                    // põe o 9
  }

  // Cada variante também na forma E.164, que é como o cadastro grava.
  for (const v of [...fora]) fora.add(`+${v}`);
  return [...fora];
}

/** O mesmo celular, escrito de formas diferentes? */
export function mesmoNumero(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = new Set(variantesDoNumero(a));
  if (va.size === 0) return false;
  return variantesDoNumero(b).some((v) => va.has(v));
}
