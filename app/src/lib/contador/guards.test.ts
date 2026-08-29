// Quem entra na área do escritório (`/contador/*`).
//
// POR QUE ESTE ARQUIVO EXISTE. A primeira versão de `requireContadorPage`
// exigia `role_types.type = 'Contador'` e mais nada. Isso trancava fora TODO
// funcionário convidado: `aceitar_convite` (0043, ramo `tipo = 'membro'`)
// insere só em `contabilidade_membros` e nunca escreve `role_types`, e o papel
// nasce `'Empresa'` por DEFAULT (0083) quando a pessoa não escolhe no cadastro.
// A regressão passou pelo tsc, por 2309 testes e pelo build sem ser notada —
// porque não havia teste nenhum cobrindo quem entra aqui.
//
// Os dois lados importam e estão cobertos: o membro convidado ENTRA, e o
// achado original da auditoria (BUG-003 — Admin e Empresa chegando ao cadastro
// de escritório) continua BLOQUEADO.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    ctx: null as null | { user: { id: string }; normalizedRole: string },
    /** Linha de `contabilidade_membros` do usuário, ou null. */
    membro: null as Record<string, unknown> | null,
  };
  return {
    estado,
    getGateContext: vi.fn(async () => h_ctx()),
    redirect: vi.fn((destino: string) => {
      // `next/navigation` sinaliza redirect lançando; reproduzimos para que o
      // fluxo pare no mesmo ponto que pararia em produção.
      throw new Error(`REDIRECT:${destino}`);
    }),
    createServerClient: vi.fn(async () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: estado.membro, error: null }) }),
        }),
      }),
    })),
  };
  function h_ctx() { return estado.ctx; }
});

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@/lib/auth/gate-context', () => ({ getGateContext: h.getGateContext }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }));

import { requireContadorPage } from './guards';

/** Devolve o destino do redirect, ou null se passou. */
async function destinoDoRedirect(): Promise<string | null> {
  try {
    await requireContadorPage();
    return null;
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (!m) throw e;
    return m[1];
  }
}

beforeEach(() => {
  h.estado.ctx = { user: { id: 'user-1' }, normalizedRole: 'contador' };
  h.estado.membro = null;
  h.redirect.mockClear();
  h.createServerClient.mockClear();
});

describe('requireContadorPage', () => {
  it('Contador entra', async () => {
    expect(await destinoDoRedirect()).toBeNull();
  });

  it('Contador nao paga consulta extra ao banco', async () => {
    // O caminho comum tem de continuar sem ida a mais: a checagem de vinculo
    // so existe para quem NAO tem o papel.
    await destinoDoRedirect();
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  // A REGRESSÃO. Sem esta asserção, exigir só o papel volta calado.
  it('MEMBRO CONVIDADO entra, mesmo com papel Empresa', async () => {
    h.estado.ctx = { user: { id: 'user-2' }, normalizedRole: 'empresa' };
    h.estado.membro = { contabilidade_id: 'contab-1' };
    expect(await destinoDoRedirect()).toBeNull();
  });

  // O achado original da auditoria — o outro lado, que não pode reabrir.
  it('Empresa SEM vinculo e barrada (BUG-003 segue fechado)', async () => {
    h.estado.ctx = { user: { id: 'user-3' }, normalizedRole: 'empresa' };
    h.estado.membro = null;
    expect(await destinoDoRedirect()).toBe('/');
  });

  it('AdminBalu sem vinculo e barrado', async () => {
    h.estado.ctx = { user: { id: 'user-4' }, normalizedRole: 'adminbalu' };
    h.estado.membro = null;
    expect(await destinoDoRedirect()).toBe('/');
  });

  it('sem sessao vai para /login, e nao para a raiz', async () => {
    h.estado.ctx = null;
    expect(await destinoDoRedirect()).toBe('/login');
  });

  it('barrado vai para a raiz, e NAO para /login', async () => {
    // Quem chegou aqui tem sessão válida — mandar para o login faria parecer
    // que a sessão caiu, e a pessoa tentaria entrar de novo sem necessidade.
    h.estado.ctx = { user: { id: 'user-5' }, normalizedRole: 'empresa' };
    expect(await destinoDoRedirect()).not.toBe('/login');
  });
});
