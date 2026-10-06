// Abrir mensagem da Caixa Postal DÁ CIÊNCIA (Decreto 70.235/72, art. 23).
// Estes testes guardam as três promessas da tela: sem confirmação não chama a
// Receita; mensagem já aberta não chama de novo; e quem abriu fica registrado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = { mensagem: null as Record<string, unknown> | null };
  const updates: Record<string, unknown>[] = [];
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: estado.mensagem, error: null });
    b.update = (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }) }; };
    return b;
  };
  const detalharMensagem = vi.fn();
  const auditoria = vi.fn(async () => {});
  return { estado, updates, builder, detalharMensagem, auditoria };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: h.builder }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.builder }) }));
vi.mock('@/lib/contador/guards', () => ({ getContabilidadeCtx: async () => ({ userId: 'u1', contabilidade: null }) }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.auditoria }));
vi.mock('@/lib/fiscal/serpro-caixa-postal', () => ({ detalharMensagem: h.detalharMensagem }));
vi.mock('@/lib/fiscal/caixa-postal-sync', () => ({ sincronizarCaixaPostalEmpresa: vi.fn() }));

import { abrirMensagemReceitaAction } from './actions';

beforeEach(() => {
  h.estado.mensagem = { id: 'm1', company_id: 'emp_1', isn: '123', conteudo: null };
  h.updates.length = 0;
  h.detalharMensagem.mockReset();
  h.auditoria.mockClear();
});

describe('abrirMensagemReceitaAction', () => {
  it('sem confirmação de ciência NÃO chama a Receita', async () => {
    const r = await abrirMensagemReceitaAction('m1', false);
    expect(r.ok).toBe(false);
    expect(h.detalharMensagem).not.toHaveBeenCalled();
  });

  it('mensagem já aberta devolve o conteúdo guardado, sem nova chamada', async () => {
    h.estado.mensagem = { id: 'm1', company_id: 'emp_1', isn: '123', conteudo: 'Texto guardado' };
    const r = await abrirMensagemReceitaAction('m1', true);
    expect(r).toEqual({ ok: true, data: { conteudo: 'Texto guardado' } });
    expect(h.detalharMensagem).not.toHaveBeenCalled();
  });

  it('abre na Receita, grava conteúdo e QUEM deu ciência, e audita', async () => {
    h.detalharMensagem.mockResolvedValue({
      ok: true, mensagem: { isn: '123', assunto: 'Intimação', corpo: 'Corpo', dataCiencia: '2026-10-06' },
    });
    const r = await abrirMensagemReceitaAction('m1', true);
    expect(r).toEqual({ ok: true, data: { conteudo: 'Corpo' } });
    expect(h.detalharMensagem).toHaveBeenCalledWith(expect.anything(), 'emp_1', '123');
    expect(h.updates[0]).toMatchObject({ conteudo: 'Corpo', aberta_por: 'u1', lida_na_receita: true, data_ciencia: '2026-10-06' });
    expect(h.auditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: 'receita.mensagem_aberta', actorUserId: 'u1' }));
  });

  // Achado do code-review (06/10): a data de reserva era a data em UTC — às
  // 22h de Brasília já é o dia seguinte, e a ciência é o que inicia o prazo.
  it('sem dataCiencia da Receita, grava a data de HOJE EM BRASÍLIA (não em UTC)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T01:30:00Z')); // 22h30 de 10/10 em Brasília
    try {
      h.detalharMensagem.mockResolvedValue({
        ok: true, mensagem: { isn: '123', assunto: 'Aviso', corpo: 'Corpo', dataCiencia: null },
      });
      await abrirMensagemReceitaAction('m1', true);
      expect(h.updates[0].data_ciencia).toBe('2026-10-10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mensagem que a RLS não devolve (outra empresa) não é aberta', async () => {
    h.estado.mensagem = null;
    expect((await abrirMensagemReceitaAction('m_outro', true)).ok).toBe(false);
    expect(h.detalharMensagem).not.toHaveBeenCalled();
  });

  it('falha da Receita não grava nada', async () => {
    h.detalharMensagem.mockResolvedValue({ ok: false, error: 'SERPRO fora' });
    expect((await abrirMensagemReceitaAction('m1', true)).ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });
});
