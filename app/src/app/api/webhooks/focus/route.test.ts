import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O CALLBACK DA FOCUS ESCREVE EM UMA NOTA, NÃO EM TODAS QUE COMPARTILHAM A
 * REFERÊNCIA.
 *
 * ─── O ACHADO ───────────────────────────────────────────────────────────────
 * `referencia` não é única no banco: o índice é
 * `idx_notas_fiscais_company_id_referencia` — único POR EMPRESA. Este handler
 * roda com service_role e atualizava por `.eq('referencia', ref)`, sem escopo
 * de empresa.
 *
 * O caminho completo: um membro de escritório LÊ a `referencia` de uma nota do
 * cliente (`notas_fiscais_select_contador` permite), INSERE uma nota na própria
 * empresa com a mesma string (a policy de insert só exige `user_owns_company`,
 * e não diz nada sobre o valor da referência), e espera o callback do cliente.
 * Ele escrevia `chave_acesso`, `pdf_url`, `xml_url` e o payload inteiro nas duas
 * linhas — e a segunda pertence ao atacante.
 *
 * A leitura anterior ainda usava `.maybeSingle()` no mesmo filtro, que com duas
 * linhas devolve PGRST116 — e o erro era descartado.
 */

// `admin()` no route lança sem estas duas — e o catch do handler engoliria a
// exceção, deixando o teste verde por não ter chegado a lugar nenhum.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:1/nao-usado';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'chave-de-teste-nao-usada';

const h = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ filtro: { coluna: string; valor: unknown }; patch: Record<string, unknown> }>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.order = () => q;
        q.limit = async () => ({ data: h.linhas, error: null });
        return q;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (coluna: string, valor: unknown) => {
          h.updates.push({ filtro: { coluna, valor }, patch });
          return { error: null };
        },
      }),
    }),
  }),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  limitar: () => ({ ok: true }),
  ipDe: () => '127.0.0.1',
}));

vi.mock('./segredo', () => ({ segredoOk: () => true }));

import { POST } from './route';

function requisicao(corpo: Record<string, unknown>) {
  return new Request('http://localhost/api/webhooks/focus?s=seja-la-o-que-for', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

const CALLBACK = {
  ref: 'abcdef12-0f3a-4a1b-9c2d-000000000001',
  status: 'autorizado',
  codigo_verificacao: 'CHAVE-DO-CLIENTE',
  url_danfse: 'https://focus.example/danfse-do-cliente.pdf',
};

describe('webhook da Focus — escopo da escrita', () => {
  beforeEach(() => {
    h.linhas = [];
    h.updates = [];
  });

  it('atualiza por id, nunca por referencia', async () => {
    h.linhas = [{ id: 'nota-legitima', company_id: 'empresa-do-cliente', payload_focusnfe: null, created_at: '2026-09-01T10:00:00Z' }];

    await POST(requisicao(CALLBACK) as never);

    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].filtro).toEqual({ coluna: 'id', valor: 'nota-legitima' });
  });

  // O CASO QUE FECHA O ACHADO. Duas linhas com a mesma referência: a escrita tem
  // de alcançar UMA, e tem de ser a original.
  it('com referência duplicada entre empresas, escreve só na MAIS ANTIGA', async () => {
    h.linhas = [
      { id: 'nota-legitima', company_id: 'empresa-do-cliente', payload_focusnfe: null, created_at: '2026-09-01T10:00:00Z' },
      { id: 'nota-plantada', company_id: 'empresa-do-atacante', payload_focusnfe: null, created_at: '2026-09-01T11:00:00Z' },
    ];

    await POST(requisicao(CALLBACK) as never);

    expect(h.updates, 'escreveu em mais de uma nota').toHaveLength(1);
    expect(h.updates[0].filtro.valor, 'escreveu na nota plantada').toBe('nota-legitima');
    // E o dado sensível não encostou na linha do atacante.
    expect(h.updates[0].patch.chave_acesso).toBe('CHAVE-DO-CLIENTE');
    expect(h.updates[0].patch.pdf_url).toBe('https://focus.example/danfse-do-cliente.pdf');
  });

  it('callback sem nota correspondente não escreve nada', async () => {
    h.linhas = [];
    const r = await POST(requisicao(CALLBACK) as never);
    expect(h.updates).toHaveLength(0);
    // Responde 200 de propósito: a Focus reenviaria para sempre um 4xx/5xx, e o
    // callback órfão não é erro dela.
    expect(r.status).toBe(200);
  });

  it('preserva o `request` gravado antes, no payload', async () => {
    h.linhas = [{
      id: 'nota-legitima', company_id: 'e1', created_at: '2026-09-01T10:00:00Z',
      payload_focusnfe: { request: { valor: 123 } },
    }];

    await POST(requisicao(CALLBACK) as never);

    expect(h.updates[0].patch.payload_focusnfe).toEqual({
      request: { valor: 123 },
      callback: expect.objectContaining({ ref: CALLBACK.ref }),
    });
  });
});
