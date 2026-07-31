import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET = 'segredo-teste-cron-obrigacoes';
process.env.CRON_SECRET = SECRET;

const h = vi.hoisted(() => {
  const estado = {
    pendWhats: [] as Array<Record<string, unknown>>,
  };

  const rpc = vi.fn(async (nome: string) => {
    if (nome === 'materializar_obrigacoes') return { data: 0, error: null };
    if (nome === 'notificacoes_pendentes_email') return { data: [], error: null };
    if (nome === 'notificacoes_pendentes_whatsapp') return { data: estado.pendWhats, error: null };
    throw new Error(`RPC inesperada no mock: ${nome}`);
  });

  // Nenhum teste deste arquivo faz asserção sobre o UPDATE final — só precisa
  // não lançar, pra não travar o loop de WhatsApp do GET.
  const from = vi.fn((_tabela: string) => ({
    update: (_valores: Record<string, unknown>) => ({
      eq: async () => ({ data: null, error: null }),
    }),
  }));

  const createAdminClient = vi.fn(() => ({ rpc, from }));
  const sendEmail = vi.fn(async () => ({ ok: true }));
  const enviarMensagem = vi.fn(
    async (_cfg: unknown, _msg: { telefone: string; texto: string }) => ({ ok: true }),
  );
  const configDeEnv = vi.fn(() => null);
  const rodarBilling = vi.fn(async () => ({ reconciliadas: 0 }));

  return { estado, rpc, from, createAdminClient, sendEmail, enviarMensagem, configDeEnv, rodarBilling };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/clients/email', () => ({ sendEmail: h.sendEmail }));
vi.mock('@/lib/billing/cron', () => ({ rodarBilling: h.rodarBilling }));
vi.mock('@/lib/uazapi/cliente', () => ({ configDeEnv: h.configDeEnv, enviarMensagem: h.enviarMensagem }));

import { GET } from './route';

function requisicaoFalsa() {
  return new Request('http://localhost/api/cron/obrigacoes', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  h.estado.pendWhats = [];
  h.rpc.mockClear();
  h.enviarMensagem.mockClear();
});

describe('GET /api/cron/obrigacoes — linha digitável na mensagem de WhatsApp', () => {
  it('notificação DAS com linha_digitavel: mensagem inclui a seção de pagamento', async () => {
    h.estado.pendWhats = [{
      id: 'n1', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Seu DAS está próximo do vencimento',
      corpo: 'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: '85810.00019 03605.999999 00000.000000 1 00000000008090',
    }];

    await GET(requisicaoFalsa());

    // Texto exato (não só stringContaining) para provar a ORDEM: título,
    // corpo, código de pagamento, e só depois o link — cobre o caso de
    // linha_digitavel + action_href juntos.
    const chamada = h.enviarMensagem.mock.calls[0][1] as { telefone: string; texto: string };
    expect(chamada.telefone).toBe('+5511999990000');
    expect(chamada.texto).toBe(
      'Seu DAS está próximo do vencimento\n\n' +
      'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.\n\n' +
      'Código para pagar (copie e cole no app do seu banco):\n' +
      '85810.00019 03605.999999 00000.000000 1 00000000008090\n\n' +
      'https://balu-contabil.vercel.app/impostos',
    );
  });

  it('notificação DAS sem linha_digitavel (null): mensagem igual ao formato atual', async () => {
    h.estado.pendWhats = [{
      id: 'n2', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Seu DAS está próximo do vencimento',
      corpo: 'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: null,
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).toBe(
      'Seu DAS está próximo do vencimento\n\nSeu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.\n\nhttps://balu-contabil.vercel.app/impostos',
    );
  });

  it('linha_digitavel como string vazia: tratada como ausente', async () => {
    h.estado.pendWhats = [{
      id: 'n3', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: '',
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('Código para pagar');
    expect(chamada.texto).toBe('Título\n\nCorpo');
  });

  it('linha_digitavel só com espaços em branco: tratada como ausente', async () => {
    h.estado.pendWhats = [{
      id: 'n5', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: '   ',
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('Código para pagar');
    expect(chamada.texto).toBe('Título\n\nCorpo');
  });

  it('notificação de outro tipo (pgdas_pendente): linha_digitavel nula não aparece', async () => {
    h.estado.pendWhats = [{
      id: 'n4', owner_user_id: 'u1', tipo: 'pgdas_pendente',
      titulo: 'Declaração mensal (PGDAS-D) pendente',
      corpo: 'A declaração do mês 202607 ainda não foi transmitida.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: null,
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('Código para pagar');
  });
});
