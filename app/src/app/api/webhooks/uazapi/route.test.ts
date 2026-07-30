// Bloco 6B, Task 6 — webhook de entrada da uazapi.
//
// ⚠️ FORMATO DO PAYLOAD DA UAZAPI NAO CONFIRMADO — ajuste esta forma para a
// real assim que a Task 5/6 sondar contra uma instância de verdade.
//
// Cada teste morde uma mudança específica que hoje passaria pelo
// `tsc --noEmit`:
//   1. segredo errado responder != 200, ou != ok:false — quebraria o contrato
//      "sempre 200" que evita loop de reentrega;
//   2. reentrega concorrente do mesmo messageId (colisão 23505 no INSERT que
//      reivindica a linha) chamar IA/reenviar mensagem — duplicaria resposta
//      ao cliente e cobraria a IA duas vezes;
//   3. telefone desconhecido não avisar o remetente, ou não deixar rastro;
//   4. `resolvido:false` não escalar para o contador quando há escritório
//      vinculado, ou inventar destinatário quando não há;
//   5. `resolvido:true` escalar mesmo assim (ruído para o contador);
//   6. sem config_ia, tentar chamar a IA em vez do fallback estático;
//   7. falha no envio (`enviarMensagem` ok:false) gravar/considerar
//      `resolvido:true` mesmo sem entrega, deixando o cliente sem resposta
//      E sem escalação — ninguém fica sabendo;
//   8. falha no UPDATE final (a linha já reivindicada pelo claim) sumir sem
//      log.
//
// Idempotência via CLAIM: o handler agora faz um INSERT logo no começo (que
// já É a linha de auditoria) para reivindicar `message_id_externo` na hora —
// a UNIQUE constraint do banco é o gate atômico, não mais um SELECT prévio.
// O mock de `insert` para `whatsapp_atendimentos` devolve `{ code: '23505' }`
// quando `estado.erroClaim` está setado, simulando a colisão. O registro
// final passa a ser um UPDATE (`.eq('id', ...)`) da mesma linha, não mais um
// segundo INSERT.
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
type Atualizacao = { tabela: string; valores: Record<string, unknown> };
type ErroPg = { code?: string; message: string };

const h = vi.hoisted(() => {
  const inserts: Insercao[] = [];
  const updates: Atualizacao[] = [];

  const estado = {
    profile: null as { user_id: string; current_company: string | null } | null,
    company: null as { id: string; contabilidade_id: string | null } | null,
    membro: null as { user_id: string } | null,
    cfg: null as Record<string, unknown> | null,
    textoGerado: JSON.stringify({ resposta: 'Resposta gerada pela IA.', resolvido: true }),
    erroIa: null as unknown,
    situacao: { texto: 'Sua situação fiscal: DAS em dia.', geradoPor: 'groq/llama' } as
      { texto: string; geradoPor: string | null } | null,
    // Setado só pelo teste de colisão concorrente: simula o INSERT do claim
    // batendo na UNIQUE constraint de `message_id_externo` (23505).
    erroClaim: null as ErroPg | null,
    // Setado só pelo teste de falha no UPDATE final.
    erroUpdate: null as ErroPg | null,
    // Consultado pela busca de "primeira interação" (persona Assistente Balu):
    // null = nenhum atendimento anterior para este telefone = primeira mensagem.
    interacaoAnterior: null as { id: string } | null,
  };

  const dadosPorTabela = (tabela: string) => {
    if (tabela === 'profiles') return estado.profile;
    if (tabela === 'companies') return estado.company;
    if (tabela === 'contabilidade_membros') return estado.membro;
    if (tabela === 'config_ia') return estado.cfg;
    // Explícito (em vez de cair no `return null` de baixo) para não colidir
    // por acidente com os outros usos de `whatsapp_atendimentos` neste mesmo
    // mock (`insert`/`update`/`upsert` são caminhos distintos de `select`).
    if (tabela === 'whatsapp_atendimentos') return estado.interacaoAnterior;
    return null;
  };

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        neq: (_c: unknown, _v: unknown) => b,
        order: (_c: unknown, _o: unknown) => b,
        limit: (_n: number) => b,
        maybeSingle: async () => ({ data: dadosPorTabela(tabela), error: null }),
      };
      return b;
    },
    // Único chamador hoje: o claim de idempotência em `whatsapp_atendimentos`
    // (`.insert(...).select('id').single()`). `estado.erroClaim` simula a
    // colisão 23505 de uma reentrega concorrente do mesmo messageId.
    insert: (valores: Record<string, unknown>) => {
      inserts.push({ tabela, valores });
      return {
        select: (_cols: string) => ({
          single: async () => {
            if (tabela === 'whatsapp_atendimentos' && estado.erroClaim) {
              return { data: null, error: estado.erroClaim };
            }
            return { data: { id: 'atend_novo' }, error: null };
          },
        }),
      };
    },
    // Único chamador hoje: a gravação final do atendimento
    // (`.update(...).eq('id', atendimentoId)`), que atualiza a linha já
    // reivindicada pelo claim. `estado.erroUpdate` simula falha transitória
    // do banco nesse UPDATE.
    update: (valores: Record<string, unknown>) => ({
      eq: async (_c: unknown, _v: unknown) => {
        updates.push({ tabela, valores });
        if (tabela === 'whatsapp_atendimentos' && estado.erroUpdate) {
          return { data: null, error: estado.erroUpdate };
        }
        return { data: null, error: null };
      },
    }),
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
  const gerarTexto = vi.fn(async (_cfg: unknown, _prompt: string) => {
    if (estado.erroIa) throw estado.erroIa;
    return estado.textoGerado;
  });
  const lerChaveIa = vi.fn((c: string | null) => (c ? 'chave-decifrada-de-teste' : null));
  const limitar = vi.fn(async () => true);

  return {
    inserts, updates, estado, from, enviarMensagem, configDeEnv, buscarSituacaoAtualMei,
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
  h.updates.length = 0;
  h.estado.profile = { user_id: 'user_1', current_company: 'empresa_1' };
  h.estado.company = { id: 'empresa_1', contabilidade_id: null };
  h.estado.membro = null;
  h.estado.cfg = { id: 1, provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave_cifrada: 'enc:v1:xxx' };
  h.estado.textoGerado = JSON.stringify({ resposta: 'Resposta gerada pela IA.', resolvido: true });
  h.estado.erroIa = null;
  h.estado.situacao = { texto: 'Sua situação fiscal: DAS em dia.', geradoPor: 'groq/llama' };
  h.estado.erroClaim = null;
  h.estado.erroUpdate = null;
  h.estado.interacaoAnterior = null;

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

  // Crux do Bug 1: duas requisições com o MESMO messageId, a segunda chegando
  // enquanto a primeira ainda está em voo. O gate é o INSERT do claim batendo
  // na UNIQUE constraint (23505) — não mais um SELECT prévio (que deixaria as
  // duas verem "não visto" e as DUAS chamarem IA + enviarMensagem). Por isso a
  // asserção central aqui não é só "respondeu duplicado", é "nunca tocou
  // IA/envio" — provar que o SEGUNDO request nunca chega perto de gastar nada.
  it('claim colide (23505 — reentrega concorrente): duplicado, SEM tocar IA nem envio', async () => {
    h.estado.erroClaim = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "whatsapp_atendimentos_message_id_externo_key"',
    };
    const res = await POST(requisicaoFalsa({ messageId: 'm-dup', from: '+55119999', text: 'oi' }, SEGREDO));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reason).toBe('duplicado');
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    expect(h.gerarTexto).not.toHaveBeenCalled();
    expect(h.buscarSituacaoAtualMei).not.toHaveBeenCalled();
    // Nenhuma gravação além da tentativa de claim que colidiu — em especial,
    // nenhum UPDATE (não há linha própria para atualizar; a colisão pertence
    // à OUTRA requisição).
    expect(h.updates).toHaveLength(0);
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
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
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
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
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
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
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
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
  });

  it('IA devolve resposta vazia ou resolvido fora de tipo: tambem cai no fallback', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: '   ', resolvido: 'sim' });
    const res = await POST(requisicaoFalsa({ messageId: 'm11', from: '+551199', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
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

  // Bug 2: `resolvido` não pode refletir só o que a IA achou — tem que
  // refletir se a mensagem CHEGOU. A IA aqui diz resolvido:true (ver
  // `textoGerado` padrão do beforeEach), mas o envio falha: o cliente não
  // recebeu nada, então isto NÃO pode ficar marcado como resolvido, e a
  // escalação (que só dispara em `!resolvido`) precisa disparar mesmo assim
  // — senão ninguém no escritório fica sabendo que o cliente ficou sem
  // resposta.
  it('envio falha com IA dizendo resolvido:true: forca resolvido:false E ainda escala', async () => {
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_1' };
    h.estado.membro = { user_id: 'contador_1' };
    h.enviarMensagem.mockResolvedValueOnce({ ok: false, erro: 'uazapi respondeu 500' });

    const res = await POST(requisicaoFalsa({ messageId: 'm-envio-falha', from: '+551100', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    const notif = h.inserts.find((i) => i.tabela === 'notifications');
    expect(notif).toBeTruthy();
    expect(notif?.valores).toMatchObject({ chave: 'whatsapp_escalado:m-envio-falha' });
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
  });

  // Bug 3 (agora reformulado): a linha de auditoria final é um UPDATE da
  // linha já reivindicada pelo claim, não mais um INSERT solto sem checagem.
  // Uma falha transitória do banco nesse UPDATE precisa aparecer no log —
  // sem PII, só um id interno e a mensagem de erro — mesmo o webhook
  // continuando a responder 200/ok (contrato "sempre 200" do arquivo).
  it('falha no UPDATE final e logada (sem PII), webhook ainda responde ok', async () => {
    h.estado.erroUpdate = { message: 'connection reset by peer' };
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(requisicaoFalsa({ messageId: 'm-update-falha', from: '+551100', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(erroSpy).toHaveBeenCalledWith(
      expect.stringMatching(/falha ao atualizar atendimento/),
      'atend_novo',
      'connection reset by peer',
    );
    // Log não deve carregar o telefone do cliente (PII) nem o texto da
    // mensagem recebida — só o id interno da linha e a mensagem de erro.
    const chamadasDeErro = erroSpy.mock.calls.map((c) => c.join(' '));
    expect(chamadasDeErro.some((linha) => linha.includes('+551100'))).toBe(false);
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

  // Achado do /code-review sobre o claim-then-update: se o claim JÁ
  // reivindicou a linha e algo lança DEPOIS disso (aqui, a leitura da
  // situação fiscal), sem recuperação a linha ficaria presa para sempre no
  // estado do claim (resolvido:false, sem resposta_enviada). Pior que o
  // comportamento pré-fix: antes, esse mesmo erro não deixava linha
  // nenhuma, então uma reentrega futura do mesmo messageId ainda podia dar
  // certo. Agora, sem recuperação, essa reentrega bateria na UNIQUE
  // constraint e voltaria "duplicado" para sempre — silêncio permanente. O
  // catch externo precisa fechar a linha com uma resposta de fallback.
  it('erro DEPOIS do claim (leitura da situacao fiscal falha): catch recupera a linha com fallback', async () => {
    h.buscarSituacaoAtualMei.mockImplementationOnce(async () => {
      throw new Error('falha inesperada de leitura');
    });
    const res = await POST(requisicaoFalsa({ messageId: 'm-erro-pos-claim', from: '+551166', text: 'oi' }, SEGREDO));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('erro_inesperado');

    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({
      resposta_enviada: expect.stringMatching(/contador vai retornar/),
      resolvido: false,
    });
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

  // Persona "Assistente Balu": a saudação só na primeira mensagem de uma
  // conversa — quem decide isso é o webhook, consultando se já existe
  // atendimento anterior para este telefone (excluindo a própria linha do
  // claim atual).
  it('primeira interacao (sem atendimento anterior): pede saudacao do Assistente Balu no prompt', async () => {
    h.estado.interacaoAnterior = null;
    await POST(requisicaoFalsa({ messageId: 'm-primeira', from: '+551100', text: 'oi' }, SEGREDO));
    const chamada = h.gerarTexto.mock.calls[0];
    const promptEnviado = String(chamada?.[1] ?? chamada?.[0]);
    expect(promptEnviado).toMatch(/primeira mensagem/i);
  });

  it('nao e a primeira interacao (ja existe atendimento anterior): NAO pede saudacao', async () => {
    h.estado.interacaoAnterior = { id: 'atend_antigo' };
    await POST(requisicaoFalsa({ messageId: 'm-repetida', from: '+551100', text: 'oi de novo' }, SEGREDO));
    const chamada = h.gerarTexto.mock.calls[0];
    const promptEnviado = String(chamada?.[1] ?? chamada?.[0]);
    expect(promptEnviado.toLowerCase()).not.toMatch(/primeira mensagem/);
  });
});
