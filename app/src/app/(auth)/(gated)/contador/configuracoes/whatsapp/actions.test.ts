// Provisionamento do canal de WhatsApp do escritório (0091).
//
// O que cada teste morde:
//   1. escritório não aprovado conseguir provisionar — instância criada para
//      quem ainda nem passou pela validação de CRC;
//   2. duplo clique em "Conectar" criar DUAS instâncias no servidor — a segunda
//      fica órfã, consumindo recurso, e ninguém sabe que existe;
//   3. o token da instância (ou o do webhook) voltar para o cliente numa
//      resposta de action — com ele, qualquer um envia em nome do escritório;
//   4. o token ser gravado em CLARO;
//   5. o webhook ser configurado sem o token do escritório na URL — sem ele a
//      entrada não sabe de quem é a mensagem, que é a base da trava de
//      isolamento.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    guard: { ok: true, id: 'contab_A', userId: 'user_1', contabilidade: { id: 'contab_A' } } as
      { ok: true; id: string; userId: string; contabilidade: unknown } | { ok: false; error: string },
    linha: {
      id: 'contab_A', nome: 'Escritorio A',
      uazapi_instancia_id: null as string | null,
      uazapi_token_cifrado: null as string | null,
      uazapi_webhook_token: null as string | null,
      uazapi_status: 'desconectado',
    },
  };
  const updates: Record<string, unknown>[] = [];

  const from = vi.fn((_t: string) => ({
    select: (_c: string) => ({
      eq: (_a: unknown, _b: unknown) => ({
        maybeSingle: async () => ({ data: estado.linha, error: null }),
      }),
    }),
    update: (valores: Record<string, unknown>) => ({
      eq: async () => { updates.push(valores); return { data: null, error: null }; },
    }),
  }));

  return {
    estado, updates, from,
    createAdminClient: vi.fn(() => ({ from })),
    requireEscritorioAprovado: vi.fn(async () => estado.guard),
    registrarAuditoria: vi.fn(async () => {}),
    criarInstancia: vi.fn(async () => ({ ok: true as const, dados: { id: 'inst_1', token: 'tok-secreto' } })),
    configurarWebhook: vi.fn(async () => ({ ok: true as const, dados: {} })),
    pedirPareamento: vi.fn(async () => ({ ok: true as const, dados: { paircode: 'ABCD-1234', status: 'connecting' } })),
    statusInstancia: vi.fn(async () => ({ ok: true as const, dados: { status: 'connected', numero: '553299998888' } })),
    desconectarInstancia: vi.fn(async () => ({ ok: true as const, dados: {} })),
    cifrarCampo: vi.fn((v: string) => `enc:v1:${v}`),
    decifrarCampo: vi.fn((v: string | null) => (v ? v.replace('enc:v1:', '') : null)),
  };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: h.requireEscritorioAprovado }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/crypto/envelope', () => ({ cifrarCampo: h.cifrarCampo, decifrarCampo: h.decifrarCampo }));
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://balucontabil.com.br' }));
vi.mock('@/lib/uazapi/provisionamento', () => ({
  criarInstancia: h.criarInstancia, configurarWebhook: h.configurarWebhook,
  pedirPareamento: h.pedirPareamento, statusInstancia: h.statusInstancia,
  desconectarInstancia: h.desconectarInstancia,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { conectarWhatsappAction, statusWhatsappAction, desconectarWhatsappAction } from './actions';

beforeEach(() => {
  h.updates.length = 0;
  h.estado.guard = { ok: true, id: 'contab_A', userId: 'user_1', contabilidade: { id: 'contab_A' } };
  h.estado.linha = {
    id: 'contab_A', nome: 'Escritorio A', uazapi_instancia_id: null,
    uazapi_token_cifrado: null, uazapi_webhook_token: null, uazapi_status: 'desconectado',
  };
  h.criarInstancia.mockClear();
  h.configurarWebhook.mockClear();
  h.pedirPareamento.mockClear();
});

describe('conectarWhatsappAction', () => {
  it('escritorio NAO aprovado nao provisiona nada', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };

    const r = await conectarWhatsappAction('5532999998888');

    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
  });

  it('numero fora de formato nao chega a criar instancia', async () => {
    const r = await conectarWhatsappAction('99999');
    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
  });

  it('cria a instancia, grava o token CIFRADO e devolve so o paircode', async () => {
    const r = await conectarWhatsappAction('5532999998888');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.paircode).toBe('ABCD-1234');
    // Nenhum token na resposta — nem o da instancia, nem o do webhook.
    expect(JSON.stringify(r)).not.toContain('tok-secreto');

    const gravouToken = h.updates.find((u) => 'uazapi_token_cifrado' in u);
    expect(gravouToken?.uazapi_token_cifrado).toBe('enc:v1:tok-secreto');
    expect(gravouToken?.uazapi_token_cifrado).not.toBe('tok-secreto');
    // 32 bytes em hex — e um por escritorio.
    expect(String(gravouToken?.uazapi_webhook_token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o webhook aponta para a nossa URL COM o token do escritorio', async () => {
    await conectarWhatsappAction('5532999998888');

    const [, siteUrl, tokenWebhook] = h.configurarWebhook.mock.calls[0] as unknown as [string, string, string];
    expect(siteUrl).toBe('https://balucontabil.com.br');
    expect(tokenWebhook).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SEGUNDO clique nao cria outra instancia (a orfa ficaria cobrando recurso)', async () => {
    h.estado.linha.uazapi_instancia_id = 'inst_1';
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';

    const r = await conectarWhatsappAction('5532999998888');

    expect(r.ok).toBe(true);
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.pedirPareamento).toHaveBeenCalledTimes(1);
  });
});

describe('statusWhatsappAction', () => {
  it('sem instancia, devolve desconectado sem falar com a uazapi', async () => {
    const r = await statusWhatsappAction();
    expect(r.ok && r.dados.status).toBe('desconectado');
    expect(h.statusInstancia).not.toHaveBeenCalled();
  });

  it('traduz o vocabulario da uazapi para o do banco e carimba a conexao', async () => {
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';

    const r = await statusWhatsappAction();

    expect(r.ok && r.dados.status).toBe('conectado');   // 'connected' -> 'conectado'
    const u = h.updates.find((x) => 'uazapi_status' in x);
    expect(u?.uazapi_status).toBe('conectado');
    expect(u?.uazapi_conectado_em).toBeTruthy();
  });
});

describe('desconectarWhatsappAction', () => {
  it('limpa numero e status, mantendo a instancia para trocar de aparelho', async () => {
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';

    const r = await desconectarWhatsappAction();

    expect(r.ok).toBe(true);
    const u = h.updates.find((x) => 'uazapi_status' in x);
    expect(u).toMatchObject({ uazapi_status: 'desconectado', uazapi_numero: null });
    // A instancia NAO e apagada: o token e o webhook continuam valendo.
    expect(u).not.toHaveProperty('uazapi_instancia_id');
    expect(u).not.toHaveProperty('uazapi_token_cifrado');
  });
});
