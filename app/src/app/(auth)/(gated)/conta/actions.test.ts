import { describe, it, expect, vi } from 'vitest';
import { salvarWhatsappAction } from './actions';

// USER_ID vive dentro de vi.hoisted: vi.mock/vi.hoisted são hoisteados para o topo
// do módulo e executam antes de qualquer `const` do corpo do arquivo — referenciar
// um const externo aqui dispara TDZ ("Cannot access before initialization").
const h = vi.hoisted(() => ({
  USER_ID: 'user_1',
  linhaProfile: { user_id: 'user_1', whatsapp_numero: null as string | null, whatsapp_habilitado_em: null as string | null },
  erro: null as { message: string } | null,
}));

const USER_ID = h.USER_ID;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.USER_ID } } }) },
    from: (tabela: string) => {
      if (tabela !== 'profiles') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update: (valores: Record<string, unknown>) => ({
          eq: (_col: string, _val: string) => {
            if (h.erro) return Promise.resolve({ error: h.erro });
            Object.assign(h.linhaProfile, valores);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('salvarWhatsappAction', () => {
  it('ativar grava o numero E carimba o consentimento', async () => {
    const fd = new FormData();
    fd.set('ativar', 'on');
    fd.set('whatsapp_numero', '+5511999998888');
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(true);
    expect(h.linhaProfile.whatsapp_numero).toBe('+5511999998888');
    expect(h.linhaProfile.whatsapp_habilitado_em).not.toBeNull();
  });

  it('recusa numero fora do formato E.164', async () => {
    const fd = new FormData();
    fd.set('ativar', 'on');
    fd.set('whatsapp_numero', '11999998888');
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(false);
  });

  // DESATIVAR NAO APAGA O NUMERO — só o carimbo. Reativar depois não obriga
  // a redigitar, e sem o carimbo a RPC de disparo já não vê a linha.
  it('desativar limpa o carimbo, preserva o numero', async () => {
    h.linhaProfile.whatsapp_numero = '+5511999998888';
    h.linhaProfile.whatsapp_habilitado_em = new Date().toISOString();
    const fd = new FormData();
    // sem 'ativar' no FormData == desligar, mesmo padrão de checkbox do e-mail
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(true);
    expect(h.linhaProfile.whatsapp_habilitado_em).toBeNull();
    expect(h.linhaProfile.whatsapp_numero).toBe('+5511999998888');
  });
});
