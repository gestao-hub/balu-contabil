// Bloco 4B — a CHAVE DE IDEMPOTÊNCIA DA SUBMISSÃO, gerada no navegador.
//
// POR QUE ELA EXISTE: o serviço avulso não tem chave natural — cobrar duas
// vezes a mesma consultoria do mesmo cliente é legítimo. Quem separa "duplo
// clique" de "cobrar de novo" é este UUID, gerado UMA VEZ POR ABERTURA do
// formulário de cobrança e renovado só depois de uma emissão bem-sucedida. É
// dele que `emitir-cobranca.ts` tira a reserva tomada ANTES da chamada ao Asaas
// e o índice único parcial da 0055.
//
// POR QUE ELA MORA AQUI E NÃO DENTRO DO COMPONENTE: para poder ser testada. O
// vitest deste repo só roda `src/**/*.test.ts` em ambiente node — regra que
// gera dinheiro real não pode ficar num `.tsx` fora do alcance de qualquer
// teste. Puro de propósito (mesmo motivo de `avulso.ts`): zero import, zero
// I/O, zero env, zero `server-only` — é importado por Client Component.

/**
 * UUID v4 em MINÚSCULAS, ou `null` quando não há fonte de aleatoriedade.
 *
 * MINÚSCULAS porque o CHECK de formato da 0055 aceita só `[0-9a-f]` e
 * `z.string().uuid()` aceita hexadecimal MAIÚSCULO — sem isto, uma chave em
 * maiúsculas viraria erro cru de Postgres na tela do contador. (O zod da
 * fronteira normaliza também; as duas pontas cuidando disso é de propósito.)
 *
 * `crypto.randomUUID()` só existe em contexto seguro (https/localhost); daí o
 * fallback por `getRandomValues`. Não há fallback para `Math.random()`: chave
 * fraca colide, e colisão aqui significa uma cobrança LEGÍTIMA recusada como
 * duplicada. Sem fonte criptográfica, devolver `null` e não emitir é o lado
 * seguro de errar.
 */
export function novaChaveEmissao(
  fonte: Crypto | undefined = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto,
): string | null {
  if (typeof fonte?.randomUUID === 'function') return fonte.randomUUID().toLowerCase();
  if (typeof fonte?.getRandomValues === 'function') {
    const b = fonte.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versão 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
}
