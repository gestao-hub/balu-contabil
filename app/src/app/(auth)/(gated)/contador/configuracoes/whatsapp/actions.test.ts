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
//      isolamento;
//   6. (24/08/2026, QR code) o QR vazar para a auditoria — ele é credencial de
//      sessão do WhatsApp, e quem o ler no minuto seguinte conecta o próprio
//      aparelho no lugar do escritório;
//   7. a conexão por QR gravar um `uazapi_numero` que ninguém confirmou — no
//      QR o número só se sabe DEPOIS, pelo `owner` da instância.
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
    // Data-URI curta de propósito: o formato real (~1,8 KB) não acrescenta nada
    // ao teste, e o que importa é que a string chegue INTEIRA na resposta.
    pedirQrCode: vi.fn(async () => ({ ok: true as const, dados: { qrcode: 'data:image/png;base64,QRFALSO', status: 'connecting' } })),
    statusInstancia: vi.fn(async () => (
      { ok: true as const, dados: { status: 'connected', numero: '553299998888', qrcode: null as string | null } }
    )),
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
  pedirQrCode: h.pedirQrCode, pedirPareamento: h.pedirPareamento,
  statusInstancia: h.statusInstancia, desconectarInstancia: h.desconectarInstancia,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  conectarWhatsappAction, conectarPorCodigoAction, statusWhatsappAction, desconectarWhatsappAction,
} from './actions';

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
  h.pedirQrCode.mockClear();
  h.registrarAuditoria.mockClear();
  h.statusInstancia.mockResolvedValue(
    { ok: true as const, dados: { status: 'connected', numero: '553299998888', qrcode: null } },
  );
});

describe('conectarWhatsappAction — QR code (caminho principal)', () => {
  it('escritorio NAO aprovado nao provisiona nada', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };

    const r = await conectarWhatsappAction();

    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.pedirQrCode).not.toHaveBeenCalled();
  });

  it('cria a instancia, grava o token CIFRADO e devolve so o QR', async () => {
    const r = await conectarWhatsappAction();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.qrcode).toBe('data:image/png;base64,QRFALSO');
    // Nenhum token na resposta — nem o da instancia, nem o do webhook.
    expect(JSON.stringify(r)).not.toContain('tok-secreto');

    const gravouToken = h.updates.find((u) => 'uazapi_token_cifrado' in u);
    expect(gravouToken?.uazapi_token_cifrado).toBe('enc:v1:tok-secreto');
    expect(String(gravouToken?.uazapi_webhook_token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('NAO grava numero nenhum: no QR so se sabe qual e depois de conectar', async () => {
    // Gravar um numero aqui seria inventar: quem escaneia decide o aparelho, e
    // o `owner` real so chega em `statusWhatsappAction`.
    await conectarWhatsappAction();

    for (const u of h.updates) expect(u).not.toHaveProperty('uazapi_numero');
    // O ULTIMO, e nao o primeiro: `garantirInstancia` grava 'desconectado' ao
    // criar a instancia, e o estado que vale e o que sobra no fim.
    const status = h.updates.filter((u) => 'uazapi_status' in u);
    expect(status.at(-1)?.uazapi_status).toBe('conectando');
  });

  it('o QR NUNCA entra na auditoria', async () => {
    await conectarWhatsappAction();

    expect(h.registrarAuditoria).toHaveBeenCalledTimes(1);
    const registro = JSON.stringify(h.registrarAuditoria.mock.calls[0]);
    expect(registro).not.toContain('QRFALSO');
    expect(registro).not.toContain('data:image');
  });

  it('o webhook aponta para a nossa URL COM o token do escritorio', async () => {
    await conectarWhatsappAction();

    const [, siteUrl, tokenWebhook] = h.configurarWebhook.mock.calls[0] as unknown as [string, string, string];
    expect(siteUrl).toBe('https://balucontabil.com.br');
    expect(tokenWebhook).toMatch(/^[0-9a-f]{64}$/);
  });

  it('SEGUNDO clique nao cria outra instancia (a orfa ficaria cobrando recurso)', async () => {
    h.estado.linha.uazapi_instancia_id = 'inst_1';
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';

    const r = await conectarWhatsappAction();

    expect(r.ok).toBe(true);
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.pedirQrCode).toHaveBeenCalledTimes(1);
  });

  it('recusa da uazapi vira erro na tela, sem gravar conectando', async () => {
    h.pedirQrCode.mockResolvedValueOnce(
      { ok: false as const, erro: 'Esta instância já está conectada.' } as never,
    );

    const r = await conectarWhatsappAction();

    expect(r).toEqual({ ok: false, error: 'Esta instância já está conectada.' });
    expect(h.updates.find((u) => u.uazapi_status === 'conectando')).toBeUndefined();
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('conectarPorCodigoAction — a saida de quem tem um aparelho so', () => {
  // NAO e legado: nao da para escanear um QR com o mesmo celular que se quer
  // conectar. Apagar este caminho deixa esse escritorio sem nenhuma saida.
  it('escritorio NAO aprovado nao provisiona nada', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };

    const r = await conectarPorCodigoAction('5532999998888');

    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
  });

  it('numero fora de formato nao chega a criar instancia', async () => {
    const r = await conectarPorCodigoAction('99999');
    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
  });

  it('devolve so o paircode, e grava o numero que foi digitado', async () => {
    const r = await conectarPorCodigoAction('5532999998888');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.paircode).toBe('ABCD-1234');
    expect(JSON.stringify(r)).not.toContain('tok-secreto');

    const u = h.updates.find((x) => 'uazapi_numero' in x);
    expect(u?.uazapi_numero).toBe('5532999998888');
  });

  it('SEGUNDO clique nao cria outra instancia', async () => {
    h.estado.linha.uazapi_instancia_id = 'inst_1';
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';

    const r = await conectarPorCodigoAction('5532999998888');

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

  it('devolve o QR corrente enquanto conecta — e por isso o polling e UMA chamada', async () => {
    // O servidor rotaciona o QR sozinho (medido em 24/08/2026: muda a cada
    // ~20s). Se este campo parar de voltar, a tela mostra um QR expirado e o
    // escritorio escaneia no vazio: sem erro, sem explicacao.
    h.estado.linha.uazapi_token_cifrado = 'enc:v1:tok-secreto';
    h.statusInstancia.mockResolvedValueOnce(
      { ok: true as const, dados: { status: 'connecting', numero: null as unknown as string, qrcode: 'data:image/png;base64,QR2' } },
    );

    const r = await statusWhatsappAction();

    expect(r.ok && r.dados.status).toBe('conectando');
    expect(r.ok && r.dados.qrcode).toBe('data:image/png;base64,QR2');
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
