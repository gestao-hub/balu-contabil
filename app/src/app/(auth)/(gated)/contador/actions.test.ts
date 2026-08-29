// BUG-003 (auditoria 29/08/2026) — quem pode CRIAR um escritório.
//
// O que estava aberto: `criarContabilidadeAction` checava só "tem sessão" e
// "ainda não é membro de nenhum escritório". Não checava PAPEL. E grava com
// `createAdminClient()` (service role), então não havia RLS por baixo para
// segurar — diferente do caminho de notas fiscais, onde a policy de INSERT era
// a última rede. Aqui não havia rede nenhuma: qualquer usuário autenticado
// criava um escritório e virava membro dele.
//
// Não era teórico. `contador/page.tsx` manda quem não tem vínculo para
// `/contador/cadastro`, e "não tem vínculo" incluía Admin e Empresa — eles
// chegavam ao formulário pela navegação normal, sem forjar nada.
//
// Cada teste aqui MORDE uma mutação:
//   1. remover `requireContadorAction` da action;
//   2. mantê-la mas ignorar o retorno (não dar `return` no ramo de erro);
//   3. movê-la para DEPOIS do insert em `contabilidades`.
//
// TUDO MOCKADO NA FRONTEIRA: os dois clients Supabase e `next/cache`. O guard
// real roda — é ele que está sob teste.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const inserts: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
  const estado = {
    user: { id: 'user-1' } as { id: string } | null,
    /** `role_types.type` — o papel canônico (enum: Empresa | Contador | AdminBalu). */
    papel: 'Contador' as string | null,
    /** Linha de `contabilidade_membros` do usuário, se já for membro. */
    jaMembro: null as Record<string, unknown> | null,
  };

  /** Client de SESSÃO: só `auth.getUser` e a leitura de `role_types`. */
  const createServerClient = vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: estado.user } }) },
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            tabela === 'role_types'
              ? { data: estado.papel ? { type: estado.papel } : null, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }));

  /** Client de SERVICE ROLE: onde a escrita acontece — e onde ela NÃO pode
   *  acontecer para quem não é contador. */
  const createAdminClient = vi.fn(() => ({
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: estado.jaMembro, error: null }) }),
      }),
      insert: (valores: Record<string, unknown>) => {
        inserts.push({ tabela, valores });
        return {
          select: () => ({
            single: async () => ({ data: { id: 'contab-nova-1' }, error: null }),
          }),
          // `contabilidade_membros` insere sem `.select()`; o await cai aqui.
          then: (r: (v: { error: null }) => unknown) => r({ error: null }),
        };
      },
    }),
  }));

  return {
    inserts, estado, createServerClient, createAdminClient,
    revalidatePath: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));

import { criarContabilidadeAction } from './actions';

const INPUT_VALIDO = {
  nome: 'Escritório Teste Contabilidade',
  cnpj: '11222333000181',
  crc: 'SP-123456',
  crc_uf: 'SP',
};

beforeEach(() => {
  h.inserts.length = 0;
  h.estado.user = { id: 'user-1' };
  h.estado.papel = 'Contador';
  h.estado.jaMembro = null;
  h.revalidatePath.mockClear();
});

describe('criarContabilidadeAction — guarda de papel', () => {
  it('Empresa NAO cria escritorio, e nada e gravado', async () => {
    h.estado.papel = 'Empresa';
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r.ok).toBe(false);
    // A escrita e o que importa: a action grava com service role, sem RLS por
    // baixo. Se um insert vazar aqui, vazou de verdade no banco.
    expect(h.inserts).toHaveLength(0);
  });

  it('AdminBalu NAO cria escritorio, e nada e gravado', async () => {
    h.estado.papel = 'AdminBalu';
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('usuario sem linha em role_types NAO cria escritorio', async () => {
    // A 0104 fechou as policies de escrita de `role_types` justamente porque o
    // usuario apagava a propria linha para cair em fallback. Ausencia de papel
    // nao pode ser tratada como permissao.
    h.estado.papel = null;
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('sem sessao NAO cria escritorio', async () => {
    h.estado.user = null;
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  // O outro lado da guarda: ela nao pode ter fechado a porta para o contador.
  it('Contador cria o escritorio e vira membro dele', async () => {
    h.estado.papel = 'Contador';
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r).toEqual({ ok: true, data: { id: 'contab-nova-1' } });
    const tabelas = h.inserts.map((i) => i.tabela);
    expect(tabelas).toEqual(['contabilidades', 'contabilidade_membros']);
    // Escritorio novo nasce pendente de aprovacao do AdminBalu.
    expect(h.inserts[0].valores).toMatchObject({ status: 'pendente' });
  });

  // A guarda de papel nao substitui a regra de 1 usuario = 1 escritorio.
  it('contador que ja e membro continua sendo recusado', async () => {
    h.estado.papel = 'Contador';
    h.estado.jaMembro = { contabilidade_id: 'contab-existente' };
    const r = await criarContabilidadeAction(INPUT_VALIDO);
    expect(r).toEqual({ ok: false, error: 'Você já faz parte de um escritório.' });
    expect(h.inserts).toHaveLength(0);
  });
});
