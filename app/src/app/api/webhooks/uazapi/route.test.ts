// Bloco 6B, Task 6 — webhook de entrada da uazapi.
//
// ⚠️ FORMATO DO PAYLOAD DA UAZAPI NAO CONFIRMADO — ajuste esta forma para a
// real assim que a Task 5/6 sondar contra uma instância de verdade.
//
// Cada teste morde uma mudança específica que hoje passaria pelo
// `tsc --noEmit`:
//   1. segredo errado responder != 200, ou != ok:false — quebraria o contrato
//      "sempre 200" que evita loop de reentrega;
//   2. reentrega do mesmo messageId reenviar mensagem/regravar — duplicaria
//      resposta ao cliente e o registro de auditoria;
//   3. telefone desconhecido não avisar o remetente, ou não deixar rastro;
//   4. `resolvido:false` não escalar para o contador quando há escritório
//      vinculado, ou inventar destinatário quando não há;
//   5. `resolvido:true` escalar mesmo assim (ruído para o contador);
//   6. sem config_ia, tentar chamar a IA em vez do fallback estático.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, rate-limit, uazapi, IA — mesmo estilo
// de `admin/explicacoes/actions.test.ts` (builder de `from` que devolve o
// estado do teste por tabela, sem rede nem banco).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SEGREDO = 'segredo-de-teste-uazapi';

function requisicaoFalsa(corpo: unknown, segredo: string) {
  return new Request('http://localhost/api/webhooks/uazapi?s=' + segredo, {
    method: 'POST', body: JSON.stringify(corpo),
  });
}

type Insercao = { tabela: string; valores: Record<string, unknown> };

const h = vi.hoisted(() => {
  const inserts: Insercao[] = [];

  const estado = {
    jaVisto: null as { id: string } | null,
    profile: null as { user_id: string; current_company: string | null } | null,
    company: null as { id: string; contabilidade_id: string | null } | null,
    membro: null as { user_id: string } | null,
    cfg: null as Record<string, unknown> | null,
    textoGerado: JSON.stringify({ resposta: 'Resposta gerada pela IA.', resolvido: true }),
    erroIa: null as unknown,
    situacao: { texto: 'Sua situação fiscal: DAS em dia.', geradoPor: 'groq/llama' } as
      { texto: string; geradoPor: string | null } | null,
  };

  const dadosPorTabela = (tabela: string) => {
    if (tabela === 'whatsapp_atendimentos') return estado.jaVisto;
    if (tabela === 'profiles') return estado.profile;
    if (tabela === 'companies') return estado.company;
    if (tabela === 'contabilidade_membros') return estado.membro;
    if (tabela === 'config_ia') return estado.cfg;
    return null;
  };

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        order: (_c: unknown, _o: unknown) => b,
        limit: (_n: number) => b,
        maybeSingle: async () => ({ data: dadosPorTabela(tabela), error: null }),
      };
      return b;
    },
    insert: (valores: Record<string, unknown>) => {
      inserts.push({ tabela, valores });
      return {
        then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(ok, falhou),
      };
    },
    // `escalarParaContador` grava a notificação com `upsert` (ignoreDuplicates
    // no conflito owner_user_id+chave) — mesmo registro de chamada que `insert`
    // para o teste poder inspecionar o que foi gravado.
    upsert: (valores: Record<string, unknown>, _opts?: unknown) => {
      inserts.push({ tabela, valores });
      return {
        then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(ok, falhou),
      };
    },
  }));

  type ResultadoEnvio = { ok: true } | { ok: false; erro?: string; skipped?: true };
  const enviarMensagem = vi.fn(
    async (_cfg: unknown, _msg: { telefone: string; texto: string }): Promise<ResultadoEnvio> => ({ ok: true }),
  );
  const configDeEnv = vi.fn(() => ({ baseUrl: 'https://instancia.uazapi.com', token: 'tok' }));
  const buscarSituacaoAtualMei = vi.fn(async () => estado.situacao);
  const gerarTexto = vi.fn(async () => {
    if (estado.erroIa) throw estado.erroIa;
    return estado.textoGerado;
  });
  const lerChaveIa = vi.fn((c: string | null) => (c ? 'chave-decifrada-de-teste' : null));
  const limitar = vi.fn(async () => true);

  return {
    inserts, estado, from, enviarMensagem, configDeEnv, buscarSituacaoAtualMei,
    gerarTexto, lerChaveIa, limitar,
  };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/security/rate-limit', () => ({ limitar: h.limitar }));
vi.mock('@/lib/uazapi/cliente', () => ({ enviarMensagem: h.enviarMensagem, configDeEnv: h.configDeEnv }));
vi.mock('@/lib/explicacoes/situacao-atual-mei', () => ({ buscarSituacaoAtualMei: h.buscarSituacaoAtualMei }));
vi.mock('@/lib/ai/cliente', () => ({ gerarTexto: h.gerarTexto }));
vi.mock('@/lib/ai/config-ia', () => ({ lerChaveIa: h.lerChaveIa }));

import { POST } from './route';

beforeEach(() => {
  process.env.UAZAPI_WEBHOOK_SECRET = SEGREDO;

  h.inserts.length = 0;
  h.estado.jaVisto = null;
  h.estado.profile = { user_id: 'user_1', current_company: 'empresa_1' };
  h.estado.company = { id: 'empresa_1', contabilidade_id: null };
  h.estado.membro = null;
  h.estado.cfg = { id: 1, provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave_cifrada: 'enc:v1:xxx' };
  h.estado.textoGerado = JSON.stringify({ resposta: 'Resposta gerada pela IA.', resolvido: true });
  h.estado.erroIa = null;
  h.estado.situacao = { texto: 'Sua situação fiscal: DAS em dia.', geradoPor: 'groq/llama' };

  h.limitar.mockClear();
  h.limitar.mockImplementation(async () => true);
  h.enviarMensagem.mockClear();
  h.gerarTexto.mockClear();
  h.lerChaveIa.mockClear();
  h.buscarSituacaoAtualMei.mockClear();

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('webhook uazapi', () => {
  it('segredo errado e rejeitado, sempre 200', async () => {
    const res = await POST(requisicaoFalsa({ messageId: 'm1', from: '+5511999998888', text: 'oi' }, 'errado'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });

  it('rate limit estourado: sempre 200 e nao chega no segredo/DB', async () => {
    h.limitar.mockResolvedValueOnce(false);
    const res = await POST(requisicaoFalsa({ messageId: 'm-rl', from: '+551100', text: 'oi' }, SEGREDO));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('rate_limited');
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });

  it('payload invalido (JSON quebrado) responde 200 sem quebrar', async () => {
    const req = new Request('http://localhost/api/webhooks/uazapi?s=' + SEGREDO, {
      method: 'POST', body: '{ nao é json',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('payload_invalido');
  });

  it('idempotencia: mesmo messageId ja visto nao reenvia nem regrava', async () => {
    h.estado.jaVisto = { id: 'atend_1' };
    const res = await POST(requisicaoFalsa({ messageId: 'm-dup', from: '+55119999', text: 'oi' }, SEGREDO));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reason).toBe('duplicado');
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    expect(h.gerarTexto).not.toHaveBeenCalled();
    expect(h.inserts.filter((i) => i.tabela === 'whatsapp_atendimentos')).toHaveLength(0);
  });

  it('telefone desconhecido: avisa o remetente e grava o atendimento sem resolver', async () => {
    h.estado.profile = null;
    const res = await POST(requisicaoFalsa({ messageId: 'm2', from: '+55110000', text: 'oi' }, SEGREDO));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reason).toBe('telefone_desconhecido');
    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(h.gerarTexto).not.toHaveBeenCalled();
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({
      message_id_externo: 'm2', telefone: '+55110000', resolvido: false,
    });
  });

  it('resolvido=true: responde ao cliente e NAO escala', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Seu DAS está em dia.', resolvido: true });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_1' };
    h.estado.membro = { user_id: 'contador_1' };

    const res = await POST(requisicaoFalsa({ messageId: 'm3', from: '+551111', text: 'Meu DAS venceu?' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ texto: 'Seu DAS está em dia.' }),
    );
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: true, resposta_enviada: 'Seu DAS está em dia.' });
  });

  it('resolvido=false com escritorio vinculado: escala para o membro mais antigo', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Vou encaminhar para o contador.', resolvido: false });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_1' };
    h.estado.membro = { user_id: 'contador_1' };

    const res = await POST(requisicaoFalsa({ messageId: 'm4', from: '+551122', text: 'Preciso de ajuda complexa' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    const notif = h.inserts.find((i) => i.tabela === 'notifications');
    expect(notif).toBeTruthy();
    expect(notif?.valores).toMatchObject({
      owner_user_id: 'contador_1',
      company_id: 'empresa_1',
      tipo: 'whatsapp_escalado',
      chave: 'whatsapp_escalado:m4',
    });
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
  });

  it('resolvido=false SEM escritorio (self-service): nao escala e nao quebra', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Vou encaminhar.', resolvido: false });
    h.estado.company = { id: 'empresa_1', contabilidade_id: null };

    const res = await POST(requisicaoFalsa({ messageId: 'm5', from: '+551133', text: 'Ajuda' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
  });

  it('resolvido=false com escritorio SEM membros: nao escala e nao quebra', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Vou encaminhar.', resolvido: false });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_vazia' };
    h.estado.membro = null;

    const res = await POST(requisicaoFalsa({ messageId: 'm6', from: '+551144', text: 'Ajuda' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
  });

  it('sem config_ia configurado: usa a resposta padrao e nao chama a IA', async () => {
    h.estado.cfg = null;
    const res = await POST(requisicaoFalsa({ messageId: 'm7', from: '+551155', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.gerarTexto).not.toHaveBeenCalled();
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texto: expect.stringMatching(/contador vai retornar/) }),
    );
  });

  it('falha da IA (lanca) nao derruba o webhook: cai no fallback e ainda grava', async () => {
    h.estado.erroIa = new Error('provedor fora do ar');
    const res = await POST(requisicaoFalsa({ messageId: 'm9', from: '+551177', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texto: expect.stringMatching(/contador vai retornar/) }),
    );
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
  });

  // O modelo pode devolver JSON válido mas fora da forma esperada — isso NAO
  // lança em JSON.parse. Sem checagem em runtime, `resposta` chegaria
  // `undefined` em `enviarMensagem`, e `JSON.stringify` apagaria a chave
  // `text` silenciosamente: o cliente nunca receberia resposta nenhuma.
  it('IA devolve JSON valido mas fora de forma ({}): cai no fallback, nao manda undefined', async () => {
    h.estado.textoGerado = JSON.stringify({});
    const res = await POST(requisicaoFalsa({ messageId: 'm10', from: '+551188', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texto: expect.stringMatching(/contador vai retornar/) }),
    );
    // nunca "texto: undefined" indo pro envio
    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: unknown };
    expect(typeof chamada.texto).toBe('string');
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
  });

  it('IA devolve resposta vazia ou resolvido fora de tipo: tambem cai no fallback', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: '   ', resolvido: 'sim' });
    const res = await POST(requisicaoFalsa({ messageId: 'm11', from: '+551199', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
    expect((grav?.valores as { resposta_enviada: string }).resposta_enviada).toMatch(/contador vai retornar/);
  });

  it('falha ao enviar a mensagem (uazapi fora do ar) e logada, mas o webhook ainda responde ok', async () => {
    h.enviarMensagem.mockResolvedValueOnce({ ok: false, erro: 'uazapi respondeu 500' });
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(requisicaoFalsa({ messageId: 'm12', from: '+551100', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(erroSpy).toHaveBeenCalledWith(
      expect.stringMatching(/falha ao enviar resposta/), 'uazapi respondeu 500',
    );
  });

  // A ordem importa: `limitar` e chaveado por `corpo.from`, um campo NAO
  // autenticado. Se rodasse antes do segredo, um atacante sem o segredo
  // poderia estourar o orcamento de rate-limit de um numero de cliente real.
  it('segredo errado: nunca chega a chamar o rate-limit (ordem segredo-antes)', async () => {
    const res = await POST(requisicaoFalsa({ messageId: 'm13', from: '+5511vitima', text: 'oi' }, 'errado'));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(h.limitar).not.toHaveBeenCalled();
  });

  it('erro inesperado em qualquer ponto do fluxo: o catch externo ainda responde 200/ok:false', async () => {
    h.buscarSituacaoAtualMei.mockImplementationOnce(async () => {
      throw new Error('falha inesperada de leitura');
    });
    const res = await POST(requisicaoFalsa({ messageId: 'm14', from: '+551166', text: 'oi' }, SEGREDO));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('erro_inesperado');
  });
});
