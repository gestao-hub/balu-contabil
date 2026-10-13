// Conta de teste (0113): só AdminBalu marca; marcar grava a marca E aplica no
// banco; desmarcar desfaz pela função do banco; tudo auditado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const upserts: Record<string, unknown>[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const admin = {
    from: () => ({ upsert: async (v: Record<string, unknown>) => { upserts.push(v); return { error: null }; } }),
    rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { error: null }; },
  };
  const guard = vi.fn();
  const auditoria = vi.fn(async () => {});
  return { upserts, rpcs, admin, guard, auditoria };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: h.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.auditoria }));

import { definirContaTesteAction } from './actions';

beforeEach(() => {
  h.upserts.length = 0;
  h.rpcs.length = 0;
  h.guard.mockReset().mockResolvedValue({ userId: 'admin_1' });
  h.auditoria.mockClear();
});

describe('definirContaTesteAction', () => {
  it('quem não é AdminBalu não marca nada', async () => {
    h.guard.mockResolvedValue({ error: 'Acesso restrito.' });
    expect(await definirContaTesteAction('u1', true)).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.upserts).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
  });

  it('marcar grava a marca, aplica no banco (cortesia + escritório aprovado) e audita', async () => {
    expect(await definirContaTesteAction('u1', true)).toEqual({ ok: true });
    expect(h.upserts[0]).toMatchObject({ user_id: 'u1', marcada_por: 'admin_1' });
    expect(h.rpcs).toEqual([{ fn: 'aplicar_conta_teste', args: { p_user: 'u1' } }]);
    expect(h.auditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: 'usuario.conta_teste_marcada', alvoId: 'u1' }));
  });

  it('desmarcar usa a função do banco que tira a marca e devolve a assinatura a trial', async () => {
    expect(await definirContaTesteAction('u1', false)).toEqual({ ok: true });
    expect(h.upserts).toHaveLength(0);
    expect(h.rpcs).toEqual([{ fn: 'remover_conta_teste', args: { p_user: 'u1' } }]);
    expect(h.auditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: 'usuario.conta_teste_desmarcada' }));
  });
});
