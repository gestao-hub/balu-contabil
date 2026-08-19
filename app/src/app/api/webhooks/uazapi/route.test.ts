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
    // 0091 — canal por escritorio. null = canal da plataforma.
    escritorio: null as null | {
      id: string; nome: string; slaHoras: number | null;
      whatsappSuporte: string | null; numero: string | null;
      config: { baseUrl: string; token: string } | null;
    },
    // Linhas que painel_contador_por_id devolveria para o modo ESCRITORIO.
    carteira: [] as Record<string, unknown>[],
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
      // `then` torna o builder aguardável: a busca do perfil agora termina em
      // `.in(...).limit(2)` e é consumida com `await`, sem `maybeSingle()`.
      // Sem isto, `await` no builder devolve o próprio objeto e a
      // desestruturação de `data` vira undefined — foi o que quebrou os 14
      // testes deste arquivo quando o casamento de número virou tolerante.
      const linha = dadosPorTabela(tabela);
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        neq: (_c: unknown, _v: unknown) => b,
        in: (_c: unknown, _v: unknown[]) => b,
        // Escopo do historico por contabilidade (0091): sem `is`, o builder
        // quebrava e todo teste virava erro_inesperado.
        is: (_c: unknown, _v: unknown) => b,
        // getLimitesFiscais (modo ESCRITORIO) filtra vigencia por lte.
        lte: (_c: unknown, _v: unknown) => b,
        gte: (_c: unknown, _v: unknown) => b,
        order: (_c: unknown, _o: unknown) => b,
        limit: (_n: number) => b,
        maybeSingle: async () => ({ data: Array.isArray(linha) ? (linha[0] ?? null) : linha, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: Array.isArray(linha) ? linha : (linha ? [linha] : []), error: null }),
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

  // 0091 — resolucao de tenant, mockada na fronteira.
  const CANAL_PLATAFORMA = { baseUrl: 'https://instancia.uazapi.com', token: 'tok-plataforma' };
  const configDaPlataforma = vi.fn(() => CANAL_PLATAFORMA);
  const escritorioPorWebhookToken = vi.fn(async () => estado.escritorio);
  const escritorioPorId = vi.fn(async () => estado.escritorio);
  // painel_contador_por_id (modo ESCRITORIO) e qualquer outra RPC.
  const rpc = vi.fn(async (nome: string) => (
    nome === 'painel_contador_por_id'
      ? { data: estado.carteira, error: null }
      : { data: null, error: null }
  ));

  return {
    inserts, updates, estado, from, rpc, enviarMensagem, configDeEnv, buscarSituacaoAtualMei,
    gerarTexto, lerChaveIa, limitar,
    configDaPlataforma, escritorioPorWebhookToken, escritorioPorId, CANAL_PLATAFORMA,
  };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from, rpc: h.rpc }) }));
vi.mock('@/lib/security/rate-limit', () => ({ limitar: h.limitar }));
vi.mock('@/lib/uazapi/cliente', () => ({ enviarMensagem: h.enviarMensagem, configDeEnv: h.configDeEnv }));
vi.mock('@/lib/explicacoes/situacao-atual-mei', () => ({ buscarSituacaoAtualMei: h.buscarSituacaoAtualMei }));
vi.mock('@/lib/ai/cliente', () => ({ gerarTexto: h.gerarTexto }));
vi.mock('@/lib/ai/config-ia', () => ({ lerChaveIa: h.lerChaveIa }));
// 0091: quem resolve o TENANT do canal. Mockado na fronteira, como o resto.
vi.mock('@/lib/uazapi/instancia', () => ({
  escritorioPorWebhookToken: h.escritorioPorWebhookToken,
  escritorioPorId: h.escritorioPorId,
  configDaPlataforma: h.configDaPlataforma,
}));

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
  h.estado.escritorio = null;
  h.estado.carteira = [];

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
    const res = await POST(requisicaoFalsa({ messageId: 'm-rl', from: '+5532987006790', text: 'oi' }, SEGREDO));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm-dup', from: '+5532987006791', text: 'oi' }, SEGREDO));
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

  it('telefone desconhecido perguntando sobre A EMPRESA DELE: avisa e nao chama IA', async () => {
    h.estado.profile = null;
    // Pergunta que DEPENDE dos números daquela empresa. Sem conta não há o que
    // responder, e o aviso de cadastrar o número é a resposta certa.
    const res = await POST(requisicaoFalsa({ messageId: 'm2', from: '5532987006789', text: 'quanto é o meu DAS deste mês?' }, SEGREDO));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reason).toBe('telefone_desconhecido');
    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(h.gerarTexto).not.toHaveBeenCalled();
    const grav = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    // Telefone gravado em DÍGITOS, sem o `+`: a normalização de entrada
    // (lib/uazapi/payload) desmonta JID e máscara antes de qualquer uso, para
    // o mesmo número não virar duas grafias no banco.
    expect(grav?.valores).toMatchObject({
      message_id_externo: 'm2', telefone: '5532987006789', resolvido: false,
    });
  });

  it('telefone desconhecido com duvida GERAL: responde pela base juridica', async () => {
    // Defeito relatado em 19/08/2026: "o que é MEI?" vindo de número não
    // cadastrado recebia "não conseguimos identificar sua conta". Conhecimento
    // geral não depende de cadastro nenhum — recusar era negar o que o app sabe
    // fazer a alguém que pode virar cliente.
    h.estado.profile = null;
    h.estado.textoGerado = JSON.stringify({ resposta: 'O MEI é o Microempreendedor Individual.', resolvido: true });

    const res = await POST(requisicaoFalsa({ messageId: 'm2-geral', from: '5532987006791', text: 'o que é MEI?' }, SEGREDO));
    const body = await res.json();

    expect(body.reason).toBe('duvida_geral_sem_conta');
    expect(h.gerarTexto).toHaveBeenCalledTimes(1);
    // O texto enviado é a resposta da IA, NUNCA o aviso de conta não encontrada.
    const [, msg] = h.enviarMensagem.mock.calls[0] as [unknown, { texto: string }];
    expect(msg.texto).toContain('O MEI é o Microempreendedor Individual.');
    expect(msg.texto).not.toMatch(/identificar sua conta/i);
    // A linha do claim vira auditoria completa: sem este UPDATE ela ficaria com
    // `resposta_enviada` nula, como se ninguém tivesse sido atendido.
    const upd = h.updates.find((u) => u.tabela === 'whatsapp_atendimentos');
    // Grava o que foi ENVIADO — saudação inclusa. Se guardasse só o miolo, o
    // histórico da conversa (que alimenta o prompt) divergiria do que o cliente leu.
    expect(upd?.valores.resposta_enviada).toContain('O MEI é o Microempreendedor Individual.');
  });

  it('a pergunta REAL que ficou muda em 19/08/2026 agora e respondida', async () => {
    // "quais os impostos que o governo cobra quando abro uma empresa" chegou
    // pelo WhatsApp e NAO recebeu nada: `imposto` estava no singular na lista e
    // a frase passava dos 40 caracteres do reconhecimento de termo solto. A
    // regua passou a ser PERGUNTA, nao vocabulario.
    h.estado.profile = null;
    const res = await POST(requisicaoFalsa(
      { messageId: 'm2-real', from: '5532991511415', text: 'quais os impostos que o governo cobra quando abro uma empresa' },
      SEGREDO));
    const body = await res.json();

    expect(body.reason).toBe('duvida_geral_sem_conta');
    expect(h.gerarTexto).toHaveBeenCalledTimes(1);
    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
  });

  it('termo fiscal solto de desconhecido ("regime tributario") tambem e respondido', async () => {
    // A régua do que conta como dúvida fiscal é a MESMA nos dois ramos
    // (TERMO_FISCAL, em lib/atendimento/classificar) — duas listas divergentes
    // fariam o assistente responder num caminho e calar no outro.
    h.estado.profile = null;
    const res = await POST(requisicaoFalsa({ messageId: 'm2-termo', from: '5532987006793', text: 'regime tributário' }, SEGREDO));
    const body = await res.json();

    expect(body.reason).toBe('duvida_geral_sem_conta');
    expect(h.gerarTexto).toHaveBeenCalledTimes(1);
  });

  it('numero desconhecido com conversa fiada NAO recebe mensagem automatica', async () => {
    // 12/08/2026: a instancia estava num aparelho com conversas pessoais e o
    // assistente respondia "nao conseguimos identificar sua conta" para quem
    // so estava falando com o dono do numero.
    h.estado.profile = null;
    const res = await POST(requisicaoFalsa({ messageId: 'm2-silencio', from: '5532987006792', text: 'Ta bom entao 👍' }, SEGREDO));
    const body = await res.json();

    expect(body.reason).toBe('telefone_desconhecido');
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });

  it('resolvido=true: responde ao cliente e NAO escala', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Seu DAS está em dia.', resolvido: true });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_1' };
    h.estado.membro = { user_id: 'contador_1' };

    const res = await POST(requisicaoFalsa({ messageId: 'm3', from: '5532987006789', text: 'Meu DAS venceu?' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ texto: expect.stringContaining('Seu DAS está em dia.') }),
    );
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: true });
    expect(grav?.valores.resposta_enviada).toContain('Seu DAS está em dia.');
  });

  it('resolvido=false com escritorio vinculado: escala para o membro mais antigo', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Vou encaminhar para o contador.', resolvido: false });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_1' };
    h.estado.membro = { user_id: 'contador_1' };

    const res = await POST(requisicaoFalsa({ messageId: 'm4', from: '+5532987006722', text: 'Preciso de ajuda complexa' }, SEGREDO));
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

    const res = await POST(requisicaoFalsa({ messageId: 'm5', from: '+5532987006733', text: 'Ajuda' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
  });

  it('resolvido=false com escritorio SEM membros: nao escala e nao quebra', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: 'Vou encaminhar.', resolvido: false });
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_vazia' };
    h.estado.membro = null;

    const res = await POST(requisicaoFalsa({ messageId: 'm6', from: '+5532987006744', text: 'Ajuda' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
  });

  it('sem config_ia configurado: usa a resposta padrao e nao chama a IA', async () => {
    h.estado.cfg = null;
    const res = await POST(requisicaoFalsa({ messageId: 'm7', from: '+5532987006755', text: 'oi' }, SEGREDO));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm9', from: '+5532987006777', text: 'oi' }, SEGREDO));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm10', from: '+5532987006788', text: 'oi' }, SEGREDO));
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

  // Achado no smoke manual do Bloco 6B: um modelo real (via OpenRouter)
  // devolveu o JSON pedido envolto em cerca de código markdown, mesmo com o
  // prompt pedindo só JSON. Sem tirar a cerca antes do JSON.parse, uma
  // resposta válida da IA era descartada e o fluxo caía no fallback à toa.
  it('IA devolve JSON envolto em cerca de codigo markdown: ainda usa a resposta real', async () => {
    h.estado.textoGerado = '```json\n' + JSON.stringify({ resposta: 'Resposta cercada.', resolvido: true }) + '\n```';
    const res = await POST(requisicaoFalsa({ messageId: 'm10b', from: '+5532987006788', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(h.enviarMensagem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ texto: expect.stringContaining('Resposta cercada.') }),
    );
  });

  it('IA devolve resposta vazia ou resolvido fora de tipo: tambem cai no fallback', async () => {
    h.estado.textoGerado = JSON.stringify({ resposta: '   ', resolvido: 'sim' });
    const res = await POST(requisicaoFalsa({ messageId: 'm11', from: '+5532987006799', text: 'oi' }, SEGREDO));
    const body = await res.json();

    expect(body.ok).toBe(true);
    const grav = h.updates.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(grav?.valores).toMatchObject({ resolvido: false });
    expect((grav?.valores as { resposta_enviada: string }).resposta_enviada).toMatch(/contador vai retornar/);
  });

  it('falha ao enviar a mensagem (uazapi fora do ar) e logada, mas o webhook ainda responde ok', async () => {
    h.enviarMensagem.mockResolvedValueOnce({ ok: false, erro: 'uazapi respondeu 500' });
    const erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(requisicaoFalsa({ messageId: 'm12', from: '+5532987006790', text: 'oi' }, SEGREDO));
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

    const res = await POST(requisicaoFalsa({ messageId: 'm-envio-falha', from: '+5532987006790', text: 'oi' }, SEGREDO));
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

    const res = await POST(requisicaoFalsa({ messageId: 'm-update-falha', from: '+5532987006790', text: 'oi' }, SEGREDO));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm13', from: '+5532987006711', text: 'oi' }, 'errado'));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm-erro-pos-claim', from: '+5532987006766', text: 'oi' }, SEGREDO));
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
    const res = await POST(requisicaoFalsa({ messageId: 'm14', from: '+5532987006766', text: 'oi' }, SEGREDO));
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
    await POST(requisicaoFalsa({ messageId: 'm-primeira', from: '+5532987006790', text: 'oi' }, SEGREDO));
    const chamada = h.gerarTexto.mock.calls[0];
    const promptEnviado = String(chamada?.[1] ?? chamada?.[0]);
    expect(promptEnviado).toMatch(/primeira mensagem/i);
  });

  it('nao e a primeira interacao (ja existe atendimento anterior): NAO pede saudacao', async () => {
    h.estado.interacaoAnterior = { id: 'atend_antigo' };
    await POST(requisicaoFalsa({ messageId: 'm-repetida', from: '+5532987006790', text: 'oi de novo' }, SEGREDO));
    const chamada = h.gerarTexto.mock.calls[0];
    const promptEnviado = String(chamada?.[1] ?? chamada?.[0]);
    expect(promptEnviado.toLowerCase()).not.toMatch(/primeira mensagem/);
  });
});

describe('saudacao da primeira mensagem', () => {
  it('a PRIMEIRA mensagem da conversa vem com a saudacao fixa', async () => {
    h.estado.interacaoAnterior = null;              // nenhuma troca anterior
    h.estado.textoGerado = JSON.stringify({ resposta: 'O MEI é o Microempreendedor Individual.', resolvido: true });

    await POST(requisicaoFalsa({ messageId: 'saud-1', from: '5532987006789', text: 'o que é mei?' }, SEGREDO));

    const [, msg] = h.enviarMensagem.mock.calls[0] as [unknown, { texto: string }];
    expect(msg.texto).toBe(
      'Olá! Sou o Balu, assistente do sistema Balu Contábil. Diga-me como posso ajudá-lo hoje.'
      + '\n\nO MEI é o Microempreendedor Individual.');
  });

  it('a SEGUNDA mensagem NAO repete a saudacao', async () => {
    // O erro que ninguem lembra de testar: cumprimentar de novo a cada
    // mensagem faz o assistente parecer que esqueceu a conversa.
    h.estado.interacaoAnterior = { id: 'atend_anterior' };
    h.estado.textoGerado = JSON.stringify({ resposta: 'O limite é de R$ 81.000 por ano.', resolvido: true });

    await POST(requisicaoFalsa({ messageId: 'saud-2', from: '5532987006789', text: 'e o limite?' }, SEGREDO));

    const [, msg] = h.enviarMensagem.mock.calls[0] as [unknown, { texto: string }];
    expect(msg.texto).toBe('O limite é de R$ 81.000 por ano.');
    expect(msg.texto).not.toMatch(/Olá! Sou o Balu/);
  });
});

// ═══ 0091 — canal por escritorio (multi-tenant) ═══
//
// Estes cinco testes sao os criterios de aceite 1, 2, 3 e 4 da spec
// docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md.
// O caminho do WhatsApp roda com service_role (RLS desligada): a garantia de
// isolamento e o filtro no codigo, entao ela precisa ser EXECUTADA, nao revisada.
describe('canal por escritorio', () => {
  const ESCRITORIO_A = {
    id: 'contab_A', nome: 'Escritorio A', slaHoras: 24,
    whatsappSuporte: '5532999990000', numero: '5532988887777',
    config: { baseUrl: 'https://a.uazapi.com', token: 'tok-A' },
  };

  function urlDoCanal(corpo: unknown, token: string) {
    return new Request('http://localhost/api/webhooks/uazapi?t=' + token, {
      method: 'POST', body: JSON.stringify(corpo),
    });
  }

  it('token de canal DESCONHECIDO nao atende e nao cria atendimento', async () => {
    h.estado.escritorio = null;   // o resolvedor nao acha o token
    const res = await POST(urlDoCanal({ messageId: 'x1', from: '5532987006789', text: 'o que é mei?' }, 'f'.repeat(64)));
    const body = await res.json();

    expect(body.reason).toBe('canal_desconhecido');
    expect(h.gerarTexto).not.toHaveBeenCalled();
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    // Sem claim: mensagem de canal que nao e nosso nao entra na auditoria de
    // atendimento (entra em audit_log, que e outra tabela).
    expect(h.inserts.filter((i) => i.tabela === 'whatsapp_atendimentos')).toHaveLength(0);
  });

  it('CRITERIO 1: cliente de OUTRO escritorio nao recebe dado fiscal nem tem o vinculo revelado', async () => {
    h.estado.escritorio = ESCRITORIO_A;
    h.estado.profile = { user_id: 'user_B', current_company: 'empresa_B' };
    // A empresa dele e de OUTRO escritorio.
    h.estado.company = { id: 'empresa_B', contabilidade_id: 'contab_B' };

    const res = await POST(urlDoCanal(
      { messageId: 'x2', from: '5532987006789', text: 'quanto é o meu DAS?' }, 'a'.repeat(64)));
    const body = await res.json();

    // Cai no MESMO desfecho de "numero nao cadastrado": a recusa nao pode
    // distinguir "voce e de outro escritorio" de "voce nao tem cadastro".
    expect(body.reason).toBe('telefone_desconhecido');
    expect(h.buscarSituacaoAtualMei).not.toHaveBeenCalled();
    const [, msg] = h.enviarMensagem.mock.calls[0] as [unknown, { texto: string }];
    expect(msg.texto).not.toMatch(/contab_B|Escritorio B/i);
  });

  it('cliente DO escritorio do canal e atendido, e a resposta sai pela instancia dele', async () => {
    h.estado.escritorio = ESCRITORIO_A;
    h.estado.profile = { user_id: 'user_1', current_company: 'empresa_1' };
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_A' };
    h.estado.textoGerado = JSON.stringify({ resposta: 'Seu DAS vence dia 20.', resolvido: true });

    await POST(urlDoCanal({ messageId: 'x3', from: '5532987006789', text: 'quando vence meu DAS?' }, 'a'.repeat(64)));

    const [cfg] = h.enviarMensagem.mock.calls[0] as unknown as [{ token: string }];
    expect(cfg.token).toBe('tok-A');            // instancia do escritorio, nao a da plataforma
    // O claim ja nasce carimbado com o escritorio: e disso que dependem o
    // escopo do historico e a fila de SLA.
    const claim = h.inserts.find((i) => i.tabela === 'whatsapp_atendimentos');
    expect(claim?.valores.contabilidade_id).toBe('contab_A');
  });

  it('CRITERIO 2: numero ambiguo no mesmo canal recusa e audita, sem responder com dado de ninguem', async () => {
    h.estado.escritorio = ESCRITORIO_A;
    h.estado.profile = [
      { user_id: 'user_1', current_company: 'empresa_1' },
      { user_id: 'user_2', current_company: 'empresa_1' },
    ] as unknown as { user_id: string; current_company: string | null };
    h.estado.company = { id: 'empresa_1', contabilidade_id: 'contab_A' };

    const res = await POST(urlDoCanal({ messageId: 'x4', from: '5532987006789', text: 'meu DAS venceu?' }, 'a'.repeat(64)));
    const body = await res.json();

    expect(body.reason).toBe('numero_ambiguo');
    expect(h.gerarTexto).not.toHaveBeenCalled();
    expect(h.inserts.some((i) => i.tabela === 'audit_log')).toBe(true);
  });

  it('CRITERIO 3 e 4: modo ESCRITORIO ve a carteira, e o prompt nao carrega CNPJ nem CRC', async () => {
    h.estado.escritorio = ESCRITORIO_A;
    h.estado.profile = { user_id: 'contador_1', current_company: null };
    h.estado.membro = { user_id: 'contador_1' };
    h.estado.carteira = [
      { company_id: 'e1', nome: 'Padaria Modelo', regime_code: '1', das_vencidos: 2,
        pgdas_mes_anterior_transmitida: false, dasn_ano_anterior_transmitida: true,
        faturamento_ano: 1000, cert_not_after: null },
      { company_id: 'e2', nome: 'Bar do Ze', regime_code: '1', das_vencidos: 0,
        pgdas_mes_anterior_transmitida: true, dasn_ano_anterior_transmitida: true,
        faturamento_ano: 500, cert_not_after: null },
    ];
    h.estado.textoGerado = JSON.stringify({ resposta: 'Voce tem 1 cliente irregular.', resolvido: true });

    const res = await POST(urlDoCanal(
      { messageId: 'x5', from: '5532991511415', text: 'quantos clientes estao irregulares?' }, 'a'.repeat(64)));
    const body = await res.json();

    expect(body.reason).toBe('modo_escritorio');
    const [, prompt] = h.gerarTexto.mock.calls[0] as [unknown, string];
    expect(prompt).toContain('Padaria Modelo');          // nome do cliente irregular
    expect(prompt).toContain('Escritorio A');            // nome do escritorio (allowlist D5)
    expect(prompt).toMatch(/PRÓPRIO CONTADOR/);
    // Allowlist fechada. A assercao e sobre o VALOR, nao sobre a palavra: o
    // prompt cita "CNPJ" e "CRC" na PROIBICAO, e proibir e o oposto de vazar.
    expect(prompt).not.toMatch(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);  // nenhum CNPJ
    expect(prompt).toMatch(/NÃO existe nenhum/);            // a proibicao esta la
    // Pergunta do contador nao escala para ele mesmo.
    expect(h.inserts.filter((i) => i.tabela === 'notifications')).toHaveLength(0);
  });
});
