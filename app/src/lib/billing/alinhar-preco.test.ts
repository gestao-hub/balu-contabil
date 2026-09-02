// A REDE DE SEGURANÇA DO REAJUSTE — `alinharPrecoComPlano`.
//
// ─── POR QUE ELA EXISTE ─────────────────────────────────────────────────────
// `admin/assinaturas/actions.ts` reajusta em lote limitado (chamadas HTTP
// sequenciais numa Server Action estouram o `maxDuration` acima de ~50). Antes
// de 02/09/2026 o excedente fazia a action RECUSAR — o que travava o reajuste
// de um plano bem-sucedido, inclusive para BAIXAR preço. Esta função é o que
// permitiu parar de recusar.
//
// Ela compara com o ASAAS DE VERDADE, e não com um campo local que dissesse
// "último valor enviado". A diferença aparece no caso que mais importa: alguém
// editar a assinatura pelo painel do Asaas. Um campo local nunca saberia.
//
// Cada teste morde uma mutação:
//   1. remover a chamada a `atualizarAssinatura` (a função vira leitura inútil);
//   2. corrigir quando NÃO há divergência (uma escrita por dia, para sempre);
//   3. comparar valor em reais com float (199.99999 dispara correção eterna);
//   4. ignorar o `ciclo` (o MRR de `metricas.ts` divide por 12 e some);
//   5. tirar o teto (o cron morre no meio, sob `maxDuration = 60`).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const updates: Array<{ id: string; value?: number; cycle?: string; description?: string }> = [];
  const consultas: string[] = [];
  const estado = {
    assinaturas: [] as Array<Record<string, unknown>>,
    planos: [] as Array<Record<string, unknown>>,
    // o que o Asaas devolve por id de assinatura
    remoto: {} as Record<string, { value: number; cycle: string }>,
    erroLeitura: null as { message: string } | null,
    falharConsulta: [] as string[],
  };
  return { updates, consultas, estado };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      const encadeia = () => q;
      for (const m of ['select', 'eq', 'in', 'not', 'limit', 'order']) q[m] = encadeia;
      q.then = (resolve: (v: unknown) => unknown) => {
        if (tabela === 'assinaturas') {
          return resolve({ data: h.estado.assinaturas, error: h.estado.erroLeitura });
        }
        if (tabela === 'planos') return resolve({ data: h.estado.planos, error: null });
        return resolve({ data: [], error: null });
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/clients/asaas', () => ({
  asaas: {
    consultarAssinatura: async (id: string) => {
      h.consultas.push(id);
      if (h.estado.falharConsulta.includes(id)) throw new Error('Asaas fora do ar');
      return h.estado.remoto[id] ?? { value: 0, cycle: 'MONTHLY' };
    },
    atualizarAssinatura: async (
      id: string, d: { value?: number; cycle?: string; description?: string },
    ) => {
      h.updates.push({ id, ...d });
      return {};
    },
  },
}));

// O módulo importa mais coisas; só o que a função usa precisa ser real.
vi.mock('@/lib/billing/reconciliar', () => ({ reconciliarAssinatura: async () => ({ mudou: false }) }));

import { alinharPrecoComPlano } from './cron';
import { createAdminClient } from '@/lib/supabase/admin';

const PLANO = { id: 'p1', nome: 'Escritório 50', valor_centavos: 24900, ciclo: 'MONTHLY' };

beforeEach(() => {
  h.updates.length = 0;
  h.consultas.length = 0;
  h.estado.assinaturas = [{ id: 'a1', plano_id: 'p1', asaas_subscription_id: 'sub_1' }];
  h.estado.planos = [PLANO];
  h.estado.remoto = { sub_1: { value: 249, cycle: 'MONTHLY' } };
  h.estado.erroLeitura = null;
  h.estado.falharConsulta = [];
});

const sb = () => createAdminClient();

describe('alinharPrecoComPlano', () => {
  // MUTAÇÃO 2: corrigir sem divergência. Uma escrita por dia, para sempre, e
  // cada uma é uma chamada paga na API de quem cobra dinheiro.
  it('em dia com o plano → NÃO escreve nada', async () => {
    const r = await alinharPrecoComPlano(sb());
    expect(r).toMatchObject({ conferidas: 1, corrigidas: 0, erros: 0 });
    expect(h.updates).toHaveLength(0);
  });

  // MUTAÇÃO 1: sem a chamada de correção a função vira leitura inútil.
  it('valor divergente → corrige para o do plano', async () => {
    h.estado.remoto = { sub_1: { value: 199, cycle: 'MONTHLY' } };

    const r = await alinharPrecoComPlano(sb());

    expect(r.corrigidas).toBe(1);
    expect(h.updates).toEqual([
      { id: 'sub_1', value: 249, cycle: 'MONTHLY', description: 'Balu — Escritório 50' },
    ]);
  });

  // MUTAÇÃO 4: ignorar o ciclo. Ao ver YEARLY, `metricas.ts` divide o valor por
  // 12 — o MRR some enquanto o Asaas cobra todo mês.
  it('ciclo divergente → corrige mesmo com o valor certo', async () => {
    h.estado.remoto = { sub_1: { value: 249, cycle: 'YEARLY' } };

    const r = await alinharPrecoComPlano(sb());

    expect(r.corrigidas).toBe(1);
    expect(h.updates[0]!.cycle).toBe('MONTHLY');
  });

  // MUTAÇÃO 3: comparar em reais com `!==` de float. O Asaas devolve
  // 249.00000000000003 e a função corrigiria todo dia, para sempre.
  it('float do Asaas não vira correção eterna', async () => {
    h.estado.remoto = { sub_1: { value: 249.00000000000003, cycle: 'MONTHLY' } };

    const r = await alinharPrecoComPlano(sb());

    expect(r.corrigidas).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  // MUTAÇÃO 5: tirar o teto. Sob `maxDuration = 60` o cron morre no meio.
  it('respeita o teto e informa quantas sobraram para amanhã', async () => {
    h.estado.assinaturas = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, plano_id: 'p1', asaas_subscription_id: `sub_${i}`,
    }));
    h.estado.remoto = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`sub_${i}`, { value: 199, cycle: 'MONTHLY' }]),
    );

    const r = await alinharPrecoComPlano(sb(), 2);

    expect(r.conferidas).toBe(2);
    expect(r.corrigidas).toBe(2);
    expect(r.restantes).toBe(3);
    expect(h.consultas).toHaveLength(2);
  });

  // Uma assinatura quebrada não pode derrubar as outras.
  it('falha numa assinatura não impede as demais', async () => {
    h.estado.assinaturas = [
      { id: 'a1', plano_id: 'p1', asaas_subscription_id: 'sub_1' },
      { id: 'a2', plano_id: 'p1', asaas_subscription_id: 'sub_2' },
    ];
    h.estado.remoto = {
      sub_1: { value: 199, cycle: 'MONTHLY' },
      sub_2: { value: 199, cycle: 'MONTHLY' },
    };
    h.estado.falharConsulta = ['sub_1'];

    const r = await alinharPrecoComPlano(sb());

    expect(r.erros).toBe(1);
    expect(r.corrigidas).toBe(1);
    expect(h.updates.map((u) => u.id)).toEqual(['sub_2']);
  });

  // Erro de leitura não pode virar "nada a fazer".
  it('leitura falhou → reporta erro e não escreve', async () => {
    h.estado.erroLeitura = { message: 'timeout' };
    const r = await alinharPrecoComPlano(sb());
    expect(r.erros).toBe(1);
    expect(h.updates).toHaveLength(0);
  });

  it('plano ausente é pulado, não estoura', async () => {
    h.estado.planos = [];
    const r = await alinharPrecoComPlano(sb());
    expect(r.erros).toBe(0);
    expect(h.updates).toHaveLength(0);
  });
});
