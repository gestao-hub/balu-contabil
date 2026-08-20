// Saude dos canais de WhatsApp (0092).
//
// O que cada teste morde:
//   1. instancia caida nao gerar aviso — o canal morre em silencio, que e
//      exatamente o modo de falhar que este arquivo existe para impedir;
//   2. falha de REDE ser tratada como queda — um blip desligaria o canal de um
//      escritorio que esta funcionando;
//   3. o aviso repetir todo dia — vira ruido e o contador para de ler.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    conectados: [] as Array<Record<string, unknown>>,
    status: { ok: true as const, dados: { status: 'connected', numero: '5532999998888' } } as
      { ok: true; dados: { status: string; numero: string | null } } | { ok: false; erro: string },
    membro: { user_id: 'contador_1' } as { user_id: string } | null,
  };
  const upserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const from = vi.fn((tabela: string) => ({
    select: (_c: string) => {
      const b = {
        eq: () => b, in: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: tabela === 'contabilidade_membros' ? estado.membro : null, error: null }),
        then: (r: (v: unknown) => void) =>
          r({ data: tabela === 'contabilidades' ? estado.conectados : [], error: null }),
      };
      return b;
    },
    update: (v: Record<string, unknown>) => ({ eq: async () => { updates.push(v); return { error: null }; } }),
    upsert: async (v: Record<string, unknown>) => { upserts.push(v); return { error: null }; },
  }));

  return {
    estado, upserts, updates, from,
    statusInstancia: vi.fn(async () => estado.status),
    decifrarCampo: vi.fn((v: string | null) => (v ? 'tok' : null)),
  };
});

vi.mock('@/lib/uazapi/provisionamento', () => ({ statusInstancia: h.statusInstancia }));
vi.mock('@/lib/crypto/envelope', () => ({ decifrarCampo: h.decifrarCampo }));

import { verificarSaudeDosCanais } from './saude';

const admin = { from: h.from } as unknown as Parameters<typeof verificarSaudeDosCanais>[0];

beforeEach(() => {
  h.upserts.length = 0; h.updates.length = 0;
  h.estado.conectados = [{ id: 'contab_A', nome: 'Escritorio A', uazapi_token_cifrado: 'enc:v1:x' }];
  h.estado.status = { ok: true, dados: { status: 'connected', numero: '5532999998888' } };
  h.estado.membro = { user_id: 'contador_1' };
});

describe('verificarSaudeDosCanais', () => {
  it('instancia conectada: nao avisa nada', async () => {
    const r = await verificarSaudeDosCanais(admin);
    expect(r).toMatchObject({ verificadas: 1, cairam: 0, avisados: 0 });
    expect(h.upserts).toHaveLength(0);
  });

  it('instancia CAIDA: marca desconectado e avisa o membro mais antigo', async () => {
    h.estado.status = { ok: true, dados: { status: 'disconnected', numero: null } };

    const r = await verificarSaudeDosCanais(admin, new Date('2026-08-20T12:00:00Z'));

    expect(r).toMatchObject({ cairam: 1, avisados: 1 });
    expect(h.updates[0]).toMatchObject({ uazapi_status: 'desconectado' });
    expect(h.upserts[0]).toMatchObject({
      owner_user_id: 'contador_1', tipo: 'whatsapp_desconectado',
      chave: 'whatsapp_desconectado:contab_A:2026-08-20',
      contabilidade_id: 'contab_A',
    });
  });

  it('falha de REDE nao e queda: nao desliga o canal de quem esta funcionando', async () => {
    h.estado.status = { ok: false, erro: 'fetch failed' };

    const r = await verificarSaudeDosCanais(admin);

    expect(r).toMatchObject({ cairam: 0, avisados: 0, erros: 1 });
    expect(h.updates).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
  });

  it('escritorio sem membro: nao inventa destinatario', async () => {
    h.estado.status = { ok: true, dados: { status: 'disconnected', numero: null } };
    h.estado.membro = null;

    const r = await verificarSaudeDosCanais(admin);

    expect(r.cairam).toBe(1);
    expect(r.avisados).toBe(0);
    expect(h.upserts).toHaveLength(0);
  });
});
