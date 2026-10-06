import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET = 'segredo-teste-cron-obrigacoes';
process.env.CRON_SECRET = SECRET;

// PINADO, e não por capricho. As asserções de mensagem de WhatsApp comparam o
// texto INTEIRO, que embute `siteUrl` — e o route lê `NEXT_PUBLIC_SITE_URL` com
// fallback para o domínio da Vercel. Sem esta linha o teste passava só quando o
// ambiente NÃO tinha a variável: quem rodasse depois de `. ./.env.local`
// (onde ela é `http://localhost:3000`) via dois testes vermelhos sem ter mexido
// em nada. Teste que depende de o ambiente estar vazio é armadilha para a
// próxima pessoa.
process.env.NEXT_PUBLIC_SITE_URL = 'https://balu-contabil.vercel.app';

const h = vi.hoisted(() => {
  const estado = {
    pendWhats: [] as Array<Record<string, unknown>>,
    pendEmail: [] as Array<Record<string, unknown>>,
    suprimidas: 0 as number,
    slaAvisos: 0 as number,
    guiasVencidas: 0 as number,
    paramAvisos: 0 as number,
    // 0091 — leituras em lote do roteamento por escritório.
    linhasPorTabela: {} as Record<string, Array<Record<string, unknown>>>,
    escritorio: null as null | { config: { baseUrl: string; token: string } | null },
  };

  const rpc = vi.fn(async (nome: string) => {
    if (nome === 'materializar_obrigacoes') return { data: 0, error: null };
    if (nome === 'notificacoes_pendentes_email') return { data: estado.pendEmail, error: null };
    if (nome === 'suprimir_whatsapp_superadas') return { data: estado.suprimidas, error: null };
    if (nome === 'materializar_sla_estourado') return { data: estado.slaAvisos, error: null };
    if (nome === 'marcar_guias_vencidas') return { data: estado.guiasVencidas, error: null };
    if (nome === 'alertar_parametros_desatualizados') return { data: estado.paramAvisos, error: null };
    if (nome === 'notificacoes_pendentes_whatsapp') return { data: estado.pendWhats, error: null };
    throw new Error(`RPC inesperada no mock: ${nome}`);
  });

  // Nenhum teste deste arquivo faz asserção sobre o UPDATE final — só precisa
  // não lançar, pra não travar o loop de WhatsApp do GET.
  // 0091: o laço de WhatsApp resolve o canal do escritório de cada cliente com
  // duas leituras em lote (notifications → companies). Sem `select` aqui, o
  // cron morria antes de chegar ao envio.
  const from = vi.fn((tabela: string) => ({
    update: (_valores: Record<string, unknown>) => ({
      eq: async () => ({ data: null, error: null }),
    }),
    select: (_cols: string) => {
      const b = {
        eq: () => b, in: () => b, is: () => b, lte: () => b, gte: () => b,
        order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: estado.linhasPorTabela[tabela] ?? [], error: null }),
      };
      return b;
    },
  }));

  const createAdminClient = vi.fn(() => ({ rpc, from }));
  const configDaPlataforma = vi.fn(() => ({ baseUrl: 'https://p.uazapi.com', token: 'tok-plataforma' }));
  const escritorioPorId = vi.fn(async () => estado.escritorio);
  const sendEmail = vi.fn(async () => ({ ok: true }));
  // O retorno é o `EnvioResultado` de `lib/uazapi/cliente` — inclui a falha.
  // Sem declarar a união, `mockResolvedValueOnce({ ok: false, erro })` não
  // compila, e os testes de falha de envio não teriam como existir.
  const enviarMensagem = vi.fn(
    async (
      _cfg: unknown, _msg: { telefone: string; texto: string },
    ): Promise<{ ok: true } | { ok: false; skipped?: true; erro?: string }> => ({ ok: true }),
  );
  const configDeEnv = vi.fn(() => null);
  const rodarBilling = vi.fn(async () => ({ reconciliadas: 0 }));
  // Mockada de propósito: sem isto ela roda de verdade contra o mock de
  // banco deste arquivo, falha, e cai no try/catch do route — passando a
  // impressão de que a conciliação foi exercitada quando não foi.
  const rodarConciliacao = vi.fn(async () => ({
    conexoes: 0, importadas: 0, conciliadas: 0, sugestoes: 0, alertas: 0, erros: [],
  }));
  // Mockada pela mesma razão que a conciliação: rodando de verdade contra o
  // mock de banco deste arquivo ela falharia e cairia no try/catch do route,
  // passando a impressão de que foi exercitada.
  const rodarApuracaoAutomatica = vi.fn(async () => ({
    competencia: '202607', elegiveis: 3, apuradas: 3, puladas: 0, erros: 0, interrompida: false,
  }));
  // Frente 3. Mockada pelo mesmo motivo das duas acima — e aqui o motivo é mais
  // forte: rodando de verdade, ela FALARIA COM A SERPRO.
  const rodarPagamentosSerpro = vi.fn(async () => ({
    elegiveis: 2, consultadas: 2, baixadas: 1, sem_data: 0, erros: 0, cortada_por_orcamento: false,
  }));

  return { estado, rpc, from, createAdminClient, configDaPlataforma, escritorioPorId, sendEmail, enviarMensagem, configDeEnv, rodarBilling, rodarConciliacao, rodarApuracaoAutomatica, rodarPagamentosSerpro };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/clients/email', () => ({ sendEmail: h.sendEmail }));
vi.mock('@/lib/billing/cron', () => ({ rodarBilling: h.rodarBilling }));
vi.mock('@/lib/conciliacao/cron', () => ({ rodarConciliacao: h.rodarConciliacao }));
vi.mock('@/lib/uazapi/cliente', () => ({ configDeEnv: h.configDeEnv, enviarMensagem: h.enviarMensagem }));
vi.mock('@/lib/uazapi/instancia', () => ({
  configDaPlataforma: h.configDaPlataforma, escritorioPorId: h.escritorioPorId,
}));
vi.mock('@/lib/fiscal/apuracao-cron', () => ({ rodarApuracaoAutomatica: h.rodarApuracaoAutomatica }));
vi.mock('@/lib/fiscal/pagamentos-serpro-cron', () => ({ rodarPagamentosSerpro: h.rodarPagamentosSerpro }));

import { GET } from './route';

function requisicaoFalsa() {
  return new Request('http://localhost/api/cron/obrigacoes', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  h.estado.pendWhats = [];
  h.estado.pendEmail = [];
  h.estado.suprimidas = 0;
  h.estado.slaAvisos = 0;
  h.estado.guiasVencidas = 0;
  h.estado.paramAvisos = 0;
  h.estado.linhasPorTabela = {};
  h.estado.escritorio = null;
  h.configDaPlataforma.mockClear();
  h.escritorioPorId.mockClear();
  h.rpc.mockClear();
  h.enviarMensagem.mockClear();
  h.rodarApuracaoAutomatica.mockClear();
  h.rodarBilling.mockClear();
  h.rodarPagamentosSerpro.mockClear();
  h.rodarConciliacao.mockClear();
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

    // DUAS mensagens: o aviso, e a linha digitável SOZINHA.
    //
    // Texto exato (não só stringContaining) porque o que se prova aqui é que a
    // segunda mensagem não tem NADA além do número — no WhatsApp o
    // toque-e-segura copia a mensagem inteira, então qualquer palavra a mais
    // vai junto para o campo do banco.
    expect(h.enviarMensagem).toHaveBeenCalledTimes(2);

    const aviso = h.enviarMensagem.mock.calls[0][1] as { telefone: string; texto: string };
    expect(aviso.telefone).toBe('+5511999990000');
    expect(aviso.texto).toBe(
      'Seu DAS está próximo do vencimento\n\n' +
      'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.\n\n' +
      'O código para pagar vai na próxima mensagem — é só tocar e segurar para copiar.\n\n' +
      'https://balu-contabil.vercel.app/impostos',
    );

    const codigo = h.enviarMensagem.mock.calls[1][1] as { telefone: string; texto: string };
    expect(codigo.telefone).toBe('+5511999990000');
    expect(codigo.texto).toBe('85810.00019 03605.999999 00000.000000 1 00000000008090');
  });

  it('sem linha digitável, manda UMA mensagem só', async () => {
    h.estado.pendWhats = [{
      id: 'n1b', owner_user_id: 'u1', tipo: 'pgdas_pendente',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: null,
    }];

    await GET(requisicaoFalsa());

    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
  });

  it('se o aviso falha, a linha digitável NÃO é enviada solta', async () => {
    // Um número sem nada em volta chegando ao cliente é pior que silêncio.
    h.estado.pendWhats = [{
      id: 'n1c', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: '85810.00019',
    }];
    h.enviarMensagem.mockResolvedValueOnce({ ok: false, erro: 'uazapi respondeu 500' });

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(corpo.whatsapp_enviados).toBe(0);
    expect(corpo.whatsapp_pulados).toBe(1);
  });

  it('se só a linha falha, nada é carimbado — a rodada seguinte reenvia as duas', async () => {
    // Carimbar aqui deixaria o cliente com "o código vai na próxima mensagem" e
    // nenhuma próxima mensagem, sem retentativa. Aviso repetido incomoda; aviso
    // sem o código para pagar não serve.
    h.estado.pendWhats = [{
      id: 'n1d', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: '85810.00019',
    }];
    h.enviarMensagem
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, erro: 'uazapi respondeu 500' });

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.enviarMensagem).toHaveBeenCalledTimes(2);
    expect(corpo.whatsapp_enviados).toBe(0);
    expect(corpo.whatsapp_pulados).toBe(1);
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
    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
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
    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
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

    expect(h.enviarMensagem).toHaveBeenCalledTimes(1);
    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('código para pagar');
  });
});

describe('GET /api/cron/obrigacoes — coalescência de WhatsApp por guia (0068)', () => {
  it('suprime as superadas ANTES de ler os pendentes', async () => {
    await GET(requisicaoFalsa());

    const nomes = h.rpc.mock.calls.map((c) => c[0] as string);
    const iSuprimir = nomes.indexOf('suprimir_whatsapp_superadas');
    const iPendentes = nomes.indexOf('notificacoes_pendentes_whatsapp');
    expect(iSuprimir).toBeGreaterThanOrEqual(0);
    // Ordem é o que faz a coalescência valer: ler primeiro devolveria o
    // backlog inteiro da guia e as quatro mensagens sairiam mesmo assim.
    expect(iSuprimir).toBeLessThan(iPendentes);
  });

  it('a resposta do cron reporta quantas foram suprimidas', async () => {
    h.estado.suprimidas = 3;

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(corpo.whatsapp_suprimidas).toBe(3);
  });
});

describe('GET /api/cron/obrigacoes — alerta de SLA de atendimento (0070)', () => {
  it('chama materializar_sla_estourado e reporta a contagem', async () => {
    h.estado.slaAvisos = 2;

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.rpc.mock.calls.map((c) => c[0])).toContain('materializar_sla_estourado');
    expect(corpo.sla_avisos).toBe(2);
  });

  it('falha no SLA não derruba a materialização das obrigações', async () => {
    // O que tem prazo legal é a obrigação fiscal; o alerta de SLA é interno.
    // Um erro nele não pode custar o dia inteiro de notificações.
    h.rpc.mockImplementationOnce(
      async () => ({ data: null, error: { message: 'boom' } }) as unknown as { data: Record<string, unknown>[]; error: null },
    );

    const res = await GET(requisicaoFalsa());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.sla_avisos).toBeNull();
    expect(h.rpc.mock.calls.map((c) => c[0])).toContain('materializar_obrigacoes');
  });
});

describe('GET /api/cron/obrigacoes — persistir guia vencida (0078)', () => {
  it('chama marcar_guias_vencidas e reporta a contagem', async () => {
    h.estado.guiasVencidas = 4;

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.rpc.mock.calls.map((c) => c[0])).toContain('marcar_guias_vencidas');
    expect(corpo.guias_vencidas).toBe(4);
  });

  it('roda DEPOIS de materializar_obrigacoes', async () => {
    await GET(requisicaoFalsa());

    const nomes = h.rpc.mock.calls.map((c) => c[0] as string);
    // Ordem é a defesa contra timeout de wall-clock, que não é capturável por
    // try/catch: o que avisa o cliente e tem prazo legal roda primeiro. Este
    // UPDATE só arruma estado gravado e pode esperar.
    expect(nomes.indexOf('materializar_obrigacoes'))
      .toBeLessThan(nomes.indexOf('marcar_guias_vencidas'));
  });

  it('falha ao marcar não derruba o cron nem os envios', async () => {
    // Troca a implementação inteira (e não mockImplementationOnce) porque o
    // erro precisa cair numa RPC específica, não na n-ésima chamada. Guarda e
    // devolve a original: `mockClear` do beforeEach não restaura implementação,
    // e sem isto o vazamento quebraria qualquer teste acrescentado depois.
    const original = h.rpc.getMockImplementation()!;
    // O cast repete o que o teste de falha do SLA já faz: o tipo inferido do
    // mock não admite `{ data: null, error: {...} }`, que é justamente a forma
    // que o supabase-js devolve em erro e o que queremos exercitar.
    h.rpc.mockImplementation(((async (nome: string) => {
      if (nome === 'marcar_guias_vencidas') return { data: null, error: { message: 'boom' } };
      if (nome === 'alertar_parametros_desatualizados') return { data: 0, error: null };
      if (nome === 'materializar_obrigacoes') return { data: 0, error: null };
      if (nome === 'materializar_sla_estourado') return { data: 0, error: null };
      if (nome === 'suprimir_whatsapp_superadas') return { data: 0, error: null };
      if (nome === 'notificacoes_pendentes_email') return { data: [], error: null };
      if (nome === 'notificacoes_pendentes_whatsapp') return { data: [], error: null };
      throw new Error(`RPC inesperada no mock: ${nome}`);
    }) as unknown as typeof original));

    let res: Response;
    let corpo: Record<string, unknown>;
    try {
      res = await GET(requisicaoFalsa());
      corpo = await res.json();
    } finally {
      h.rpc.mockImplementation(original);
    }

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.guias_vencidas).toBeNull();
    // O badge da tela continua calculando "vencida" sozinho, então falhar aqui
    // não muda nada para quem olha — some só o estado gravado daquele dia.
    expect(h.rpc.mock.calls.map((c) => c[0])).toContain('notificacoes_pendentes_whatsapp');
  });
});

describe('GET /api/cron/obrigacoes — alarme de parâmetro fiscal (0081)', () => {
  it('chama alertar_parametros_desatualizados e reporta a contagem', async () => {
    h.estado.paramAvisos = 1;

    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.rpc.mock.calls.map((c) => c[0])).toContain('alertar_parametros_desatualizados');
    expect(corpo.parametros_desatualizados).toBe(1);
  });

  it('roda DEPOIS de materializar_obrigacoes', async () => {
    await GET(requisicaoFalsa());

    const nomes = h.rpc.mock.calls.map((c) => c[0] as string);
    // Mesma disciplina do resto do cron: o que tem prazo legal primeiro. Um
    // aviso interno ao AdminBalu nunca pode custar o dia de notificações.
    expect(nomes.indexOf('materializar_obrigacoes'))
      .toBeLessThan(nomes.indexOf('alertar_parametros_desatualizados'));
  });

  it('falha no alarme não derruba o cron', async () => {
    const original = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(((async (nome: string) => {
      if (nome === 'alertar_parametros_desatualizados') return { data: null, error: { message: 'boom' } };
      if (nome === 'marcar_guias_vencidas') return { data: 0, error: null };
      if (nome === 'materializar_obrigacoes') return { data: 0, error: null };
      if (nome === 'materializar_sla_estourado') return { data: 0, error: null };
      if (nome === 'suprimir_whatsapp_superadas') return { data: 0, error: null };
      if (nome === 'notificacoes_pendentes_email') return { data: [], error: null };
      if (nome === 'notificacoes_pendentes_whatsapp') return { data: [], error: null };
      throw new Error(`RPC inesperada no mock: ${nome}`);
    }) as unknown as typeof original));

    let res: Response;
    let corpo: Record<string, unknown>;
    try {
      res = await GET(requisicaoFalsa());
      corpo = await res.json();
    } finally {
      h.rpc.mockImplementation(original);
    }

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.parametros_desatualizados).toBeNull();
  });
});

describe('GET /api/cron/obrigacoes — pagamentos na Receita (Frente 3)', () => {
  it('roda e reporta o resultado', async () => {
    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.rodarPagamentosSerpro).toHaveBeenCalledTimes(1);
    expect(corpo.pagamentos_serpro).toMatchObject({ consultadas: 2, baixadas: 1 });
  });

  it('roda DEPOIS da conciliação e ANTES do billing', async () => {
    await GET(requisicaoFalsa());

    // Mesma disciplina de ordem do resto da rota: obrigação fiscal primeiro,
    // HTTP de terceiro por último. A varredura da SERPRO é a chamada mais cara
    // do cron — antes da materialização, ela custaria o que tem prazo legal.
    const tConciliacao = h.rodarConciliacao.mock.invocationCallOrder[0];
    const tSerpro = h.rodarPagamentosSerpro.mock.invocationCallOrder[0];
    const tBilling = h.rodarBilling.mock.invocationCallOrder[0];
    expect(tConciliacao).toBeLessThan(tSerpro);
    expect(tSerpro).toBeLessThan(tBilling);
  });

  it('SERPRO fora do ar não derruba o cron nem cala o billing', async () => {
    h.rodarPagamentosSerpro.mockRejectedValueOnce(new Error('serpro 503'));

    const res = await GET(requisicaoFalsa());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.pagamentos_serpro).toMatchObject({ erro: expect.stringContaining('503') });
    expect(corpo.billing).toBeDefined();
    expect(corpo.apuracao).toBeDefined();
  });
});

describe('GET /api/cron/obrigacoes — apuração mensal automática (P2.1)', () => {
  it('roda e reporta o resultado', async () => {
    const corpo = await (await GET(requisicaoFalsa())).json();

    expect(h.rodarApuracaoAutomatica).toHaveBeenCalledTimes(1);
    expect(corpo.apuracao).toMatchObject({ competencia: '202607', apuradas: 3 });
  });

  it('roda DEPOIS do billing — é a última da fila', async () => {
    await GET(requisicaoFalsa());

    // A ordem É a segurança: tudo que tem prazo legal já gravou, e a apuração
    // é a única etapa que pode ser cortada no meio sem prejuízo (é mensal, o
    // cron é diário). Invertesse isso e uma apuração lenta calaria o billing.
    const tBilling = h.rodarBilling.mock.invocationCallOrder[0];
    const tApuracao = h.rodarApuracaoAutomatica.mock.invocationCallOrder[0];
    expect(tBilling).toBeLessThan(tApuracao);
  });

  it('apuração que explode não derruba o cron nem apaga o resto da resposta', async () => {
    h.rodarApuracaoAutomatica.mockRejectedValueOnce(new Error('boom'));

    const res = await GET(requisicaoFalsa());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.apuracao).toMatchObject({ erro: expect.stringContaining('boom') });
    // O que veio antes continua reportado — são etapas independentes.
    expect(corpo.billing).toBeDefined();
  });
});

// ─── Correções de 14/08/2026 (rodada de revisão) ────────────────────────────

describe('GET /api/cron/obrigacoes — os laços de aviso têm teto de tempo', () => {
  function avisosDeEmail(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `notif${i}`, titulo: 'DAS a vencer', corpo: 'corpo', norma: null,
      action_href: '/impostos', escritorio_nome: null, destinatario_email: `c${i}@x.com`,
    }));
  }

  it('e-mail: para no orçamento e REPORTA quantos ficaram, em vez de estourar o wall-clock', async () => {
    // Sem teto, 200 envios sequenciais passam dos 60s de maxDuration sozinhos —
    // e o que morre não é o laço, é tudo que vem DEPOIS dele (conciliação,
    // SERPRO, billing, apuração), em silêncio.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    h.estado.pendEmail = avisosDeEmail(50);
    // Cada envio "custa" 6s de relógio; o orçamento é 15s.
    h.sendEmail.mockImplementation(async () => {
      vi.advanceTimersByTime(6_000);
      return { ok: true };
    });

    try {
      const json = await (await GET(requisicaoFalsa())).json();
      expect(json.enviados).toBeLessThan(50);
      expect(json.email_restantes).toBeGreaterThan(0);
      expect(json.enviados + json.pulados + json.email_restantes).toBe(50);
    } finally {
      vi.useRealTimers();
      h.sendEmail.mockReset();
      h.sendEmail.mockResolvedValue({ ok: true });
    }
  });

  it('e-mail: fila pequena passa inteira e não reporta resto', async () => {
    h.estado.pendEmail = avisosDeEmail(3);
    const json = await (await GET(requisicaoFalsa())).json();
    expect(json.enviados).toBe(3);
    expect(json.email_restantes).toBe(0);
  });

  it('o corte de e-mail NÃO impede billing, SERPRO e apuração de rodarem', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    h.estado.pendEmail = avisosDeEmail(50);
    h.sendEmail.mockImplementation(async () => {
      vi.advanceTimersByTime(6_000);
      return { ok: true };
    });

    try {
      await GET(requisicaoFalsa());
      expect(h.rodarPagamentosSerpro).toHaveBeenCalled();
      expect(h.rodarBilling).toHaveBeenCalled();
      expect(h.rodarApuracaoAutomatica).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      h.sendEmail.mockReset();
      h.sendEmail.mockResolvedValue({ ok: true });
    }
  });
});

describe('GET /api/cron/obrigacoes — uma exceção no e-mail não cala o resto do cron', () => {
  it('sendEmail lançando não derruba o GET nem as etapas seguintes', async () => {
    // `sendEmail` foi endurecido para nunca lançar, mas o laço também passou a
    // ter try/catch: a resiliência do cron não pode depender do bom
    // comportamento de um cliente HTTP.
    h.estado.pendEmail = [{
      id: 'n1', titulo: 't', corpo: 'c', norma: null, action_href: '/impostos',
      escritorio_nome: null, destinatario_email: 'a@b.com',
    }];
    h.sendEmail.mockRejectedValueOnce(new TypeError('fetch failed'));

    try {
      const resp = await GET(requisicaoFalsa());
      expect(resp.status).toBe(200);
      const json = await resp.json();
      expect(json.ok).toBe(true);
      expect(h.rodarBilling).toHaveBeenCalled();
      expect(h.rodarApuracaoAutomatica).toHaveBeenCalled();
    } finally {
      h.sendEmail.mockReset();
      h.sendEmail.mockResolvedValue({ ok: true });
    }
  });
});

// ═══ 0091 — cada aviso sai pela instancia do escritorio do cliente ═══
describe('GET /api/cron/obrigacoes — roteamento do WhatsApp por escritorio', () => {
  function prepararUmAviso(companyId: string | null, contabilidadeId: string | null) {
    h.estado.pendWhats = [{
      id: 'n1', titulo: 'DAS a vencer', corpo: 'Sua guia vence dia 20.',
      action_href: '/impostos', whatsapp_numero: '5532987006789', linha_digitavel: null,
    }];
    h.estado.linhasPorTabela = {
      notifications: [{ id: 'n1', company_id: companyId }],
      companies: companyId ? [{ id: companyId, contabilidade_id: contabilidadeId }] : [],
    };
  }

  it('CRITERIO 6: cliente de escritorio COM instancia recebe pelo numero do escritorio', async () => {
    prepararUmAviso('empresa_1', 'contab_A');
    h.estado.escritorio = { config: { baseUrl: 'https://a.uazapi.com', token: 'tok-A' } };

    await GET(requisicaoFalsa());

    const [cfg] = h.enviarMensagem.mock.calls[0] as unknown as [{ token: string }];
    expect(cfg.token).toBe('tok-A');   // nunca o da plataforma
  });

  it('escritorio SEM instancia ainda usa o numero oficial da plataforma (regra da virada)', async () => {
    // Decisao D2 adaptada e registrada no codigo: aplicar "nao envia" ao pe da
    // letra hoje silenciaria toda a base, porque nenhum escritorio tem canal.
    prepararUmAviso('empresa_1', 'contab_A');
    h.estado.escritorio = { config: null };

    await GET(requisicaoFalsa());

    const [cfg] = h.enviarMensagem.mock.calls[0] as unknown as [{ token: string }];
    expect(cfg.token).toBe('tok-plataforma');
  });

  it('sem canal NENHUM: conta whatsapp_sem_canal e nao envia por numero qualquer', async () => {
    prepararUmAviso('empresa_1', 'contab_A');
    h.estado.escritorio = { config: null };
    h.configDaPlataforma.mockReturnValueOnce(null as unknown as { baseUrl: string; token: string });

    const res = await GET(requisicaoFalsa());
    const body = await res.json();

    expect(body.whatsapp_sem_canal).toBe(1);
    expect(body.whatsapp_enviados).toBe(0);
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });
});
