// "Pagar" do lado da empresa (06/10/2026).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    company: 'empresa_1' as string | null,
    honorario: null as Record<string, unknown> | null,
  };
  const builder = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.maybeSingle = async () => ({
      data: tabela === 'profiles' ? { current_company: estado.company } : estado.honorario,
      error: null,
    });
    return b;
  };
  const cobrarHonorario = vi.fn();
  return { estado, builder, cobrarHonorario };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: h.builder }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/contador/guards', () => ({ getContabilidadeCtx: async () => ({ userId: 'cliente_1', contabilidade: null }) }));
vi.mock('@/lib/billing/cobrar-honorario', () => ({ cobrarHonorario: h.cobrarHonorario }));

import { pagarHonorarioAction } from './pagar-actions';

beforeEach(() => {
  h.estado.company = 'empresa_1';
  h.estado.honorario = { id: 'hon_1', contabilidade_id: 'contab_1', data_pagamento: null };
  h.cobrarHonorario.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('pagarHonorarioAction', () => {
  it('emite pela subconta do escritório DO HONORÁRIO, com vencido virando hoje, e devolve a fatura', async () => {
    h.cobrarHonorario.mockResolvedValue({ ok: true, linkFatura: 'https://asaas/i/1', clienteId: 'empresa_1' });
    const r = await pagarHonorarioAction('hon_1');
    expect(r).toEqual({ ok: true, linkFatura: 'https://asaas/i/1' });
    expect(h.cobrarHonorario).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      contabilidadeId: 'contab_1', honorarioId: 'hon_1', userId: 'cliente_1', vencidoVira: 'hoje', vencimento: null,
    }));
  });

  it('cobrança em aberto que já existe: abre a MESMA fatura, sem emitir outra', async () => {
    h.cobrarHonorario.mockResolvedValue({
      ok: false, motivo: 'viva', status: 'pendente', linkFatura: 'https://asaas/i/existente', error: 'x',
    });
    expect(await pagarHonorarioAction('hon_1')).toEqual({ ok: true, linkFatura: 'https://asaas/i/existente' });
  });

  it('cobrança já paga: avisa que está pago', async () => {
    h.cobrarHonorario.mockResolvedValue({ ok: false, motivo: 'viva', status: 'paga', linkFatura: 'l', error: 'x' });
    const r = await pagarHonorarioAction('hon_1');
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/já foi pago/) });
  });

  it('honorário que não é da empresa do usuário: nem chama o motor', async () => {
    h.estado.honorario = null;
    expect((await pagarHonorarioAction('hon_outro')).ok).toBe(false);
    expect(h.cobrarHonorario).not.toHaveBeenCalled();
  });

  it('recusa do motor (ex.: subconta não aprovada) vira mensagem para o CLIENTE', async () => {
    h.cobrarHonorario.mockResolvedValue({ ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' });
    const r = await pagarHonorarioAction('hon_1');
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Fale com o seu escritório/) });
  });

  it('honorário já marcado como pago não emite', async () => {
    h.estado.honorario = { id: 'hon_1', contabilidade_id: 'contab_1', data_pagamento: '2026-10-01' };
    expect((await pagarHonorarioAction('hon_1')).ok).toBe(false);
    expect(h.cobrarHonorario).not.toHaveBeenCalled();
  });
});
