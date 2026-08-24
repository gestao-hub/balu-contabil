// Canal de WhatsApp DA PLATAFORMA (0101) — o número oficial do Balu.
//
// O que cada teste morde, e por que nenhum deles é pego pelo `tsc`:
//   1. alguém que não é AdminBalu provisionar a instância da plataforma;
//   2. duplo clique criar DUAS instâncias no servidor compartilhado — a segunda
//      fica órfã, cobrando recurso, e ninguém sabe que existe;
//   3. o token da instância voltar numa resposta de action — com ele qualquer
//      um envia mensagem em nome da plataforma inteira;
//   4. o token ser gravado em CLARO;
//   5. **o webhook levar `?t=`** — a rota `/api/webhooks/uazapi` decide o
//      tenant por precedência, e um `t` aqui faria as mensagens do número
//      oficial entrarem como se fossem de um escritório;
//   6. o QR vazar para a auditoria — é credencial de sessão do WhatsApp, e quem
//      o ler no minuto seguinte conecta o próprio aparelho no lugar do Balu;
//   7. erro de leitura da config virar "ainda não existe" e provisionar por
//      cima de uma instância que está no ar;
//   8. (0102) o admin token ser gravado SEM ser testado contra a uazapi — um
//      valor errado só se manifestaria na próxima tentativa de conectar, com a
//      mensagem "não configurado", que mente: configurado está;
//   9. o admin token vazar para a auditoria.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    guard: { userId: 'admin_1' } as { userId: string } | { error: string },
    config: { ok: true, linha: null } as
      | { ok: true; linha: Record<string, unknown> | null }
      | { ok: false; erro: string },
  };
  const escritas: Record<string, unknown>[] = [];

  const from = vi.fn((_t: string) => ({
    upsert: async (valores: Record<string, unknown>) => { escritas.push(valores); return { error: null }; },
    update: (valores: Record<string, unknown>) => ({
      eq: async () => { escritas.push(valores); return { error: null }; },
    }),
  }));

  return {
    estado, escritas, from,
    createAdminClient: vi.fn(() => ({ from })),
    requireAdminBaluAction: vi.fn(async () => h_guard()),
    registrarAuditoria: vi.fn(async (..._a: unknown[]) => {}),
    lerConfigWhatsapp: vi.fn(async () => h_config()),
    criarInstancia: vi.fn(async (..._a: unknown[]) => (
      { ok: true as const, dados: { id: 'inst_plat', token: 'tok-da-plataforma' } }
    )),
    configurarWebhookUrl: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, dados: {} })),
    pedirQrCode: vi.fn(async (..._a: unknown[]) => (
      { ok: true as const, dados: { qrcode: 'data:image/png;base64,QRFALSO', status: 'connecting' } }
    )),
    statusInstancia: vi.fn(async (..._a: unknown[]) => (
      { ok: true as const, dados: { status: 'connected', numero: '5511999990000', qrcode: null as string | null } }
    )),
    desconectarInstancia: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, dados: {} })),
    sondarAdminToken: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, dados: { instancias: 37 } })),
    gravarAdminToken: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  };
});

// Fora do `vi.hoisted` para poder ler `h.estado` sem referência circular.
function h_guard() { return h.estado.guard; }
function h_config() { return h.estado.config; }

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: h.requireAdminBaluAction }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://balucontabil.com.br' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/uazapi/config-plataforma', () => ({
  lerConfigWhatsapp: h.lerConfigWhatsapp,
  gravarAdminToken: h.gravarAdminToken,
  // A cifra de verdade não roda aqui (exigiria CERT_ENC_KEY): o que importa é
  // que o valor gravado NÃO seja o token em claro, e o prefixo prova isso.
  guardarTokenPlataforma: (v: string) => `enc:v1:${v}`,
  lerTokenPlataforma: (v: string | null) => (v ? v.replace('enc:v1:', '') : null),
}));
vi.mock('@/lib/uazapi/provisionamento', () => ({
  criarInstancia: h.criarInstancia,
  configurarWebhookUrl: h.configurarWebhookUrl,
  pedirQrCode: h.pedirQrCode,
  statusInstancia: h.statusInstancia,
  desconectarInstancia: h.desconectarInstancia,
  sondarAdminToken: h.sondarAdminToken,
}));

import {
  conectarPlataformaAction, statusPlataformaAction, desconectarPlataformaAction,
  salvarAdminTokenAction,
} from './actions';

beforeEach(() => {
  h.escritas.length = 0;
  vi.clearAllMocks();
  h.estado.guard = { userId: 'admin_1' };
  h.estado.config = { ok: true, linha: null };
  process.env.UAZAPI_WEBHOOK_SECRET = 'segredo-da-plataforma';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('conectarPlataformaAction', () => {
  it('quem NAO e AdminBalu nao provisiona nada', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };

    const r = await conectarPlataformaAction();

    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.pedirQrCode).not.toHaveBeenCalled();
  });

  it('cria a instancia, grava o token CIFRADO e devolve so o QR', async () => {
    const r = await conectarPlataformaAction();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.qrcode).toBe('data:image/png;base64,QRFALSO');
    // Nenhum token na resposta.
    expect(JSON.stringify(r)).not.toContain('tok-da-plataforma');

    const gravou = h.escritas.find((e) => 'token_cifrado' in e);
    expect(gravou?.token_cifrado).toBe('enc:v1:tok-da-plataforma');
    expect(gravou?.token_cifrado).not.toBe('tok-da-plataforma');
    expect(gravou?.instancia_id).toBe('inst_plat');
  });

  it('o webhook aponta para ?s= e NUNCA para ?t=', async () => {
    // Um `?t=` aqui faria as mensagens do numero oficial entrarem como se
    // fossem de um escritorio, e a carteira inteira do assistente sairia errada.
    await conectarPlataformaAction();

    const urls = h.configurarWebhookUrl.mock.calls.map((c) => String(c[1]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('/api/webhooks/uazapi?s=segredo-da-plataforma');
      expect(url).not.toContain('?t=');
      expect(url).not.toContain('&t=');
    }
  });

  it('sem UAZAPI_WEBHOOK_SECRET, conecta assim mesmo e NAO configura webhook', async () => {
    // Enviar sem receber e melhor do que nao conectar; o que nao pode e o
    // silencio — dai o console.error, que o proprio teste garante existir.
    delete process.env.UAZAPI_WEBHOOK_SECRET;

    const r = await conectarPlataformaAction();

    expect(r.ok).toBe(true);
    expect(h.configurarWebhookUrl).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('o QR NUNCA entra na auditoria', async () => {
    await conectarPlataformaAction();

    expect(h.registrarAuditoria).toHaveBeenCalledTimes(1);
    const registro = JSON.stringify(h.registrarAuditoria.mock.calls[0]);
    expect(registro).not.toContain('QRFALSO');
    expect(registro).not.toContain('data:image');
  });

  it('SEGUNDO clique nao cria outra instancia', async () => {
    h.estado.config = { ok: true, linha: { instancia_id: 'inst_plat', token_cifrado: 'enc:v1:tok-da-plataforma' } };

    const r = await conectarPlataformaAction();

    expect(r.ok).toBe(true);
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.pedirQrCode).toHaveBeenCalledTimes(1);
  });

  it('instancia existe mas o token nao decifra: erro nomeado, e NAO reprovisiona', async () => {
    // Lição do code-review de 19/08/2026 no caminho do escritório: guardar
    // pelos dois juntos faria a falha de decifra cair no `else` e criar OUTRA
    // instância, deixando a anterior rodando e sem dono no servidor.
    h.estado.config = { ok: true, linha: { instancia_id: 'inst_plat', token_cifrado: null } };

    const r = await conectarPlataformaAction();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('inst_plat');
    expect(h.criarInstancia).not.toHaveBeenCalled();
  });

  it('FALHA FECHADA: erro de leitura nao vira "ainda nao existe"', async () => {
    h.estado.config = { ok: false, erro: 'conexao caiu' };

    const r = await conectarPlataformaAction();

    expect(r.ok).toBe(false);
    expect(h.criarInstancia).not.toHaveBeenCalled();
    expect(h.escritas).toHaveLength(0);
  });
});

describe('statusPlataformaAction', () => {
  it('sem instancia, devolve desconectado sem falar com a uazapi', async () => {
    const r = await statusPlataformaAction();

    expect(r.ok && r.dados.status).toBe('desconectado');
    expect(h.statusInstancia).not.toHaveBeenCalled();
  });

  it('traduz o vocabulario da uazapi, carimba a conexao e grava o numero do owner', async () => {
    // O numero NAO e digitado em lugar nenhum desta tela: ele vem do `owner`
    // da instancia, depois que alguem escaneou.
    h.estado.config = { ok: true, linha: { instancia_id: 'inst_plat', token_cifrado: 'enc:v1:tok-da-plataforma' } };

    const r = await statusPlataformaAction();

    expect(r.ok && r.dados.status).toBe('conectado');   // 'connected' -> 'conectado'
    const u = h.escritas.find((e) => 'status' in e);
    expect(u?.status).toBe('conectado');
    expect(u?.numero).toBe('5511999990000');
    expect(u?.conectado_em).toBeTruthy();
  });

  it('devolve o QR corrente enquanto conecta — e por isso o polling e UMA chamada', async () => {
    h.estado.config = { ok: true, linha: { instancia_id: 'inst_plat', token_cifrado: 'enc:v1:tok-da-plataforma' } };
    h.statusInstancia.mockResolvedValueOnce(
      { ok: true as const, dados: { status: 'connecting', numero: null as unknown as string, qrcode: 'data:image/png;base64,QR2' } },
    );

    const r = await statusPlataformaAction();

    expect(r.ok && r.dados.status).toBe('conectando');
    expect(r.ok && r.dados.qrcode).toBe('data:image/png;base64,QR2');
  });
});

describe('desconectarPlataformaAction', () => {
  it('limpa numero e status, mantendo a instancia para trocar de aparelho', async () => {
    h.estado.config = { ok: true, linha: { instancia_id: 'inst_plat', token_cifrado: 'enc:v1:tok-da-plataforma' } };

    const r = await desconectarPlataformaAction();

    expect(r.ok).toBe(true);
    const u = h.escritas.find((e) => 'status' in e);
    expect(u).toMatchObject({ status: 'desconectado', numero: null, conectado_em: null });
    // A instancia NAO e apagada: token e webhook continuam valendo.
    expect(u).not.toHaveProperty('instancia_id');
    expect(u).not.toHaveProperty('token_cifrado');
  });

  it('quem NAO e AdminBalu nao desconecta o canal da plataforma', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };

    const r = await desconectarPlataformaAction();

    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.desconectarInstancia).not.toHaveBeenCalled();
  });
});

describe('salvarAdminTokenAction (0102)', () => {
  // POR QUE ESTE BLOCO EXISTE. Em 24/08/2026 `UAZAPI_ADMIN_TOKEN` estava no
  // `.env.local` e NÃO estava na Vercel: provisionar canal respondia "não
  // configurado" em produção e só em produção, desde a 0091, e ninguém tinha
  // como saber porque local funcionava. O token passou a morar no banco; o que
  // não pode voltar é a credencial entrar sem ninguém conferir se ela serve.
  const TOKEN = 'admin-token-obviamente-falso-0001';

  it('quem NAO e AdminBalu nao grava nada', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };

    const r = await salvarAdminTokenAction(TOKEN);

    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.sondarAdminToken).not.toHaveBeenCalled();
    expect(h.gravarAdminToken).not.toHaveBeenCalled();
  });

  it('token vazio (ou so espaco) nao chega a sondar', async () => {
    expect((await salvarAdminTokenAction('')).ok).toBe(false);
    expect((await salvarAdminTokenAction('   ')).ok).toBe(false);
    expect(h.sondarAdminToken).not.toHaveBeenCalled();
    expect(h.gravarAdminToken).not.toHaveBeenCalled();
  });

  it('TESTA ANTES DE GRAVAR: uazapi recusou, nada e salvo', async () => {
    h.sondarAdminToken.mockResolvedValueOnce(
      { ok: false as const, erro: 'A uazapi recusou este admin token (401).' } as never,
    );

    const r = await salvarAdminTokenAction(TOKEN);

    expect(r).toEqual({ ok: false, error: 'A uazapi recusou este admin token (401).' });
    expect(h.gravarAdminToken).not.toHaveBeenCalled();
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('uazapi aceitou: grava, e devolve a contagem como prova', async () => {
    const r = await salvarAdminTokenAction(`  ${TOKEN}  `);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.instancias).toBe(37);
    // O valor sondado e o gravado sao o MESMO, e sem os espacos da colagem.
    expect(h.sondarAdminToken).toHaveBeenCalledWith(TOKEN);
    expect(h.gravarAdminToken).toHaveBeenCalledWith(TOKEN, 'admin_1');
  });

  it('o admin token NUNCA entra na auditoria', async () => {
    await salvarAdminTokenAction(TOKEN);

    expect(h.registrarAuditoria).toHaveBeenCalledTimes(1);
    const registro = JSON.stringify(h.registrarAuditoria.mock.calls[0]);
    expect(registro).not.toContain(TOKEN);
    // O que fica registrado e a PROVA de que funcionou, nao o segredo.
    expect(registro).toContain('37');
  });

  it('falha ao gravar nao vira sucesso silencioso', async () => {
    h.gravarAdminToken.mockResolvedValueOnce({ ok: false as const, erro: 'banco fora' } as never);

    const r = await salvarAdminTokenAction(TOKEN);

    expect(r.ok).toBe(false);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });
});
