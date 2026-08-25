import { describe, it, expect, vi, beforeEach } from 'vitest';

// Estado do mock do Supabase. `fila` = o que a consulta da fila devolve;
// `retornos` = quantas mensagens novas o telefone mandou depois do agradecimento.
const h = vi.hoisted(() => {
  const estado = {
    fila: [] as Array<Record<string, unknown>>,
    erroFila: null as { message: string } | null,
    retornos: 0,
    envioOk: true,
    erroUpdate: null as { message: string } | null,
    canalPlataforma: { baseUrl: 'https://uaz.test', token: 'tok' } as unknown,
  };
  const updates: Array<Record<string, unknown>> = [];
  // `..._a: unknown[]` e nao `()`: sem os parametros na assinatura, o tipo de
  // `mock.calls[0]` e `[]` e o `as [unknown, {texto:string}]` do teste vira
  // erro de tsc — a suite passava e o typecheck reprovava.
  const enviarMensagem = vi.fn(async (..._a: unknown[]) => (estado.envioOk
    ? { ok: true as const }
    : { ok: false as const, erro: 'instancia fora do ar' }));
  const configDaPlataforma = vi.fn(async () => estado.canalPlataforma);
  const escritorioPorId = vi.fn(async () => ({ config: estado.canalPlataforma }));
  return { estado, updates, enviarMensagem, configDaPlataforma, escritorioPorId };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      const encadeia = () => builder;
      // A consulta da FILA termina em `.limit()`; a de RETORNO termina em `.gt()`
      // com `head:true`. As duas se distinguem pelo que o `select` recebeu.
      let ehContagem = false;
      Object.assign(builder, {
        select: (_c: string, opts?: { head?: boolean }) => {
          ehContagem = Boolean(opts?.head);
          return builder;
        },
        not: encadeia, is: encadeia, lte: encadeia, order: encadeia,
        eq: encadeia, neq: encadeia,
        limit: () => Promise.resolve(
          h.estado.erroFila ? { data: null, error: h.estado.erroFila }
            : { data: h.estado.fila, error: null },
        ),
        gt: () => Promise.resolve(
          ehContagem ? { count: h.estado.retornos, error: null } : { data: [], error: null },
        ),
        update: (payload: Record<string, unknown>) => {
          h.updates.push(payload);
          return { eq: () => Promise.resolve({ error: h.estado.erroUpdate }) };
        },
      });
      return builder;
    },
  }),
}));
vi.mock('@/lib/uazapi/cliente', () => ({ enviarMensagem: h.enviarMensagem }));
vi.mock('@/lib/uazapi/instancia', () => ({
  configDaPlataforma: h.configDaPlataforma,
  escritorioPorId: h.escritorioPorId,
}));

import { GET } from './route';
import { TEXTO_ENCERRAMENTO } from '@/lib/atendimento/agradecimento';

const SEGREDO = 'segredo-de-cron-para-teste';
const req = (auth?: string) => new Request('https://app.test/api/cron/whatsapp-encerrar', {
  headers: auth ? { authorization: auth } : {},
});
const umaLinha = (over: Record<string, unknown> = {}) => ({
  id: 'atend_1', telefone: '5532999990000', contabilidade_id: null,
  encerrar_em: new Date(Date.now() - 60_000).toISOString(), ...over,
});

beforeEach(() => {
  process.env.CRON_SECRET = SEGREDO;
  h.estado.fila = []; h.estado.erroFila = null; h.estado.retornos = 0;
  h.estado.envioOk = true; h.estado.erroUpdate = null;
  h.updates.length = 0;
  // Os TRES mocks: sem limpar os de canal, o teste "sai pelo canal do
  // escritorio" via as chamadas dos casos anteriores e reprovava por sujeira
  // minha, nao por defeito do codigo.
  h.enviarMensagem.mockClear();
  h.configDaPlataforma.mockClear();
  h.escritorioPorId.mockClear();
});

describe('cron de encerramento por inatividade', () => {
  it('sem segredo, recusa — e nao toca em atendimento nenhum', async () => {
    h.estado.fila = [umaLinha()];
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.enviarMensagem).not.toHaveBeenCalled();
  });

  it('segredo errado tambem recusa', async () => {
    const res = await GET(req('Bearer segredo-errado-de-mesmo-tamanho!!'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET ausente e 500, nao 401 — defeito de configuracao nosso', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer qualquer'));
    expect(res.status).toBe(500);
  });

  it('relogio vencido e ninguem voltou a falar: envia a despedida e carimba', async () => {
    h.estado.fila = [umaLinha()];
    const res = await GET(req(`Bearer ${SEGREDO}`));
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, encerrados: 1, cancelados: 0, falhas: 0 });
    const [, msg] = h.enviarMensagem.mock.calls[0] as [unknown, { texto: string }];
    expect(msg.texto).toBe(TEXTO_ENCERRAMENTO);
    const carimbo = h.updates.find((u) => u.encerrado_em);
    expect(carimbo).toBeTruthy();
    expect(carimbo?.encerrar_em).toBeNull();   // desarma junto
  });

  // ═══ O CASO QUE MAIS IMPORTA ═══
  // Despedir-se de quem acabou de voltar a falar e pior do que nunca ter tido
  // a funcionalidade: a pessoa esta no meio de uma pergunta e leva um "tchau".
  it('a pessoa voltou a falar: NAO se despede, so desarma', async () => {
    h.estado.fila = [umaLinha()];
    h.estado.retornos = 1;

    const body = await (await GET(req(`Bearer ${SEGREDO}`))).json();

    expect(body).toMatchObject({ encerrados: 0, cancelados: 1 });
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    // `encerrado_em` fica NULL de proposito: nao foi encerrado, foi RETOMADO.
    const desarme = h.updates.find((u) => 'encerrar_em' in u);
    expect(desarme).toEqual({ encerrar_em: null });
  });

  it('envio falhou: NAO carimba como encerrado — a proxima rodada tenta de novo', async () => {
    // "Encerrado" sem a despedida ter chegado e a falha que retorna sucesso.
    h.estado.fila = [umaLinha()];
    h.estado.envioOk = false;

    const body = await (await GET(req(`Bearer ${SEGREDO}`))).json();

    expect(body).toMatchObject({ encerrados: 0, falhas: 1 });
    expect(h.updates.find((u) => u.encerrado_em)).toBeUndefined();
  });

  it('sem canal disponivel: deixa armado, nao inventa envio', async () => {
    h.estado.fila = [umaLinha()];
    h.estado.canalPlataforma = null;

    const body = await (await GET(req(`Bearer ${SEGREDO}`))).json();

    expect(body).toMatchObject({ encerrados: 0, falhas: 1 });
    expect(h.enviarMensagem).not.toHaveBeenCalled();
    h.estado.canalPlataforma = { baseUrl: 'https://uaz.test', token: 'tok' };
  });

  it('linha de escritorio sai pelo canal DELE, nao pelo da plataforma', async () => {
    h.estado.fila = [umaLinha({ contabilidade_id: 'contab_1' })];
    await GET(req(`Bearer ${SEGREDO}`));
    expect(h.escritorioPorId).toHaveBeenCalled();
    expect(h.configDaPlataforma).not.toHaveBeenCalled();
  });

  it('fila vazia: nao faz nada e nao quebra', async () => {
    const body = await (await GET(req(`Bearer ${SEGREDO}`))).json();
    expect(body).toMatchObject({ ok: true, encerrados: 0, cancelados: 0, falhas: 0 });
  });

  it('erro ao ler a fila vira 500, nao um "ok" mentiroso', async () => {
    h.estado.erroFila = { message: 'conexao caiu' };
    const res = await GET(req(`Bearer ${SEGREDO}`));
    expect(res.status).toBe(500);
  });
});
