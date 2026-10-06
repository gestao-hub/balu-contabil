// "Responder" da fila de atendimentos (06/10/2026): a resposta sai pelo
// WhatsApp DO ESCRITÓRIO conectado, para o telefone DA LINHA (nunca um vindo do
// navegador), e só fecha o atendimento depois de enviada.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    linha: null as Record<string, unknown> | null,
    canal: null as null | { config: { baseUrl: string; token: string } | null },
    envioOk: true,
  };
  const updates: Record<string, unknown>[] = [];
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: estado.linha, error: null });
    b.update = (v: Record<string, unknown>) => { updates.push(v); return b; };
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'a1' }], error: null }).then(ok);
    return b;
  };
  const enviarMensagem = vi.fn(async () => (estado.envioOk ? { ok: true } : { ok: false, erro: 'x' }));
  return { estado, updates, builder, enviarMensagem };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: () => h.builder() }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/contador/guards', () => ({
  getContabilidadeCtx: async () => ({ userId: 'u1', contabilidade: { id: 'contab_1' } }),
}));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: vi.fn(async () => {}) }));
vi.mock('@/lib/uazapi/instancia', () => ({ escritorioPorId: async () => h.estado.canal }));
vi.mock('@/lib/uazapi/cliente', () => ({ enviarMensagem: h.enviarMensagem }));

import { responderAtendimentoAction } from './actions';

beforeEach(() => {
  h.estado.linha = { id: 'a1', telefone: '5532987006789', resposta_enviada: 'Pronto! Encaminhei…', atendido_em: null };
  h.estado.canal = { config: { baseUrl: 'https://x.uazapi.com', token: 'tok-escritorio' } };
  h.estado.envioOk = true;
  h.updates.length = 0;
  h.enviarMensagem.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('responderAtendimentoAction', () => {
  it('envia pela instância DO ESCRITÓRIO para o telefone da linha e fecha o atendimento', async () => {
    const r = await responderAtendimentoAction('a1', 'Olá! Já vou te ajudar.');
    expect(r.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      { baseUrl: 'https://x.uazapi.com', token: 'tok-escritorio' },
      { telefone: '5532987006789', texto: 'Olá! Já vou te ajudar.' },
    );
    expect(h.updates[0]).toMatchObject({ atendido_por: 'u1' });
    expect(h.updates[0].atendido_em).toBeTruthy();
    // Mantém o que o assistente já tinha dito.
    expect(String(h.updates[0].resposta_enviada)).toMatch(/Encaminhei[\s\S]*Resposta da equipe: Olá!/);
  });

  it('WhatsApp do escritório desconectado: não envia e explica', async () => {
    h.estado.canal = { config: null };
    const r = await responderAtendimentoAction('a1', 'oi');
    expect(r).toMatchObject({ ok: false });
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it('envio recusado: NÃO marca como atendido', async () => {
    h.estado.envioOk = false;
    const r = await responderAtendimentoAction('a1', 'oi');
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('já atendido ou de outro escritório: não envia', async () => {
    h.estado.linha = { ...h.estado.linha!, atendido_em: '2026-10-06T10:00:00Z' };
    expect((await responderAtendimentoAction('a1', 'oi')).ok).toBe(false);
    h.estado.linha = null;
    expect((await responderAtendimentoAction('a1', 'oi')).ok).toBe(false);
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });

  it('resposta vazia é recusada antes de qualquer coisa', async () => {
    expect((await responderAtendimentoAction('a1', '   ')).ok).toBe(false);
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });
});
