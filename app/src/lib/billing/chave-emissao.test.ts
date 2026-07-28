import { describe, it, expect } from 'vitest';
import { novaChaveEmissao } from '@/lib/billing/chave-emissao';
import { CobrarClienteSchema } from '@/types/zod';

// A chave gerada aqui é a ÚNICA trava do caminho avulso contra duplo clique:
// sem ela não há reserva antes do Asaas nem índice único depois, e dois cliques
// viram dois boletos reais. Estes testes guardam as três propriedades de que a
// trava depende — formato aceito pela fronteira, minúsculas (CHECK da 0055) e
// unicidade — mais o comportamento quando o navegador não tem como gerar uma.

const UUID_V4_MINUSCULO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Fonte que só sabe `getRandomValues` — o caminho de fallback. */
const semRandomUUID = (): Crypto => ({
  getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
    if (a instanceof Uint8Array) for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) & 0xff;
    return a;
  },
} as unknown as Crypto);

describe('novaChaveEmissao', () => {
  it('gera uuid v4 em minusculas', () => {
    const k = novaChaveEmissao();
    expect(k).toMatch(UUID_V4_MINUSCULO);
  });

  // Duas aberturas do formulario nao podem colidir: colisao aqui recusaria uma
  // cobranca legitima como "ja emitida".
  it('duas chamadas dao chaves diferentes', () => {
    expect(novaChaveEmissao()).not.toBe(novaChaveEmissao());
  });

  // A prova que fecha o circuito: o que a tela gera e exatamente o que a
  // fronteira aceita. Se um dia o formato mudar de um lado, este teste cai
  // antes de a trava sumir em silencio.
  it('a chave gerada passa na fronteira da action, e chega inteira', () => {
    const k = novaChaveEmissao();
    const r = CobrarClienteSchema.safeParse({
      companyId: '11111111-1111-4111-8111-111111111111',
      servicoAvulsoId: null, descricaoLivre: 'Hora tecnica', baseCentavos: 25000,
      vencimento: '2030-01-10', idempotencyKey: k,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.idempotencyKey).toBe(k);
  });

  // `crypto.randomUUID()` so existe em contexto seguro (https/localhost).
  it('sem randomUUID, o fallback ainda gera uuid v4 valido', () => {
    const k = novaChaveEmissao(semRandomUUID());
    expect(k).toMatch(UUID_V4_MINUSCULO);
    expect(CobrarClienteSchema.shape.idempotencyKey.safeParse(k).success).toBe(true);
  });

  // FALHA FECHADA: sem fonte criptografica preferimos NAO emitir a emitir sem
  // trava. Quem chama trata `null` recusando o envio — nao ha queda para
  // `Math.random()`, porque chave fraca colide e colisao recusa cobranca
  // legitima.
  it('sem fonte de aleatoriedade devolve null, e nao uma chave fraca', () => {
    // Objeto SEM os dois metodos — passar `undefined` aqui nao serviria: cairia
    // no parametro default (o crypto do ambiente) e devolveria chave de verdade.
    expect(novaChaveEmissao({} as unknown as Crypto)).toBeNull();
  });
});
