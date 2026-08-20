// Bloco 6A — a rede das invariantes da configuração do provedor de IA.
//
// Cada teste aqui existe para MORDER uma mudança específica que hoje passa por
// `tsc --noEmit` e pelo resto da suíte:
//   1. trocar o UPDATE por UPSERT — o que APAGARIA a chave gravada, porque o
//      upsert do PostgREST manda NULL nas colunas ausentes do payload (era o
//      que o plano deste bloco mandava fazer);
//   2. gravar a chave em claro, ou deixar `guardarChaveIa` falhar em silêncio;
//   3. devolver a chave (ou a coluna cifrada) para a tela;
//   4. mandar a chave — inteira ou mascarada — para a auditoria;
//   5. aceitar 'personalizado' sem URL base, ou gravar antes de recusar;
//   6. deixar a mensagem de erro do teste de conexão carregar a chave;
//   7. chamar `lerChaveIa` fora do `try` (ela LANÇA), derrubando a action.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria, `next/cache` e o
// cliente de IA. Não há rede nem banco. A cifra é a DE VERDADE, com uma
// CERT_ENC_KEY de teste — é o único jeito de provar que o que vai para a coluna
// está cifrado e não em claro.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerChaveIa } from '@/lib/ai/config-ia';

const USER_ID = 'user_admin_1';
// Valor obviamente falso: nenhuma chave real deve existir num fixture.
const CHAVE_FALSA = 'sk-TESTE-chave-obviamente-falsa-nunca-use-0001';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const updates: Chamada[] = [];
  const inserts: Chamada[] = [];
  const auditorias: Array<{ acao: string; alvoId?: string | null; meta?: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const configsUsadas: Array<Record<string, unknown>> = [];

  const estado = {
    // Literal, e não `USER_ID`: este factory é IÇADO acima das consts do módulo
    // e não enxerga nenhuma delas. O `beforeEach` reatribui com a const.
    guard: { userId: 'user_admin_1' } as unknown,
    /** A linha de config_ia hoje no banco. `null` = tabela vazia. */
    linha: null as Record<string, unknown> | null,
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    /** Quantas linhas o `.select('id')` do UPDATE devolve. 0 = não pegou nada. */
    linhasAfetadas: [{ id: 1 }] as { id: number }[],
    erroIa: null as unknown,
    /** Roda entre a leitura e a escrita, para simular a corrida. */
    aoAplicar: null as null | (() => void),
  };

  function construir(tabela: string, kind: 'update' | 'insert', valores: Record<string, unknown>) {
    const chamada: Chamada = { tabela, valores, eq: [], select: [] };
    (kind === 'update' ? updates : inserts).push(chamada);
    const resultado = () => {
      if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };

      if (kind === 'update') {
        estado.aoAplicar?.();
        // O MOCK HONRA AS CONDIÇÕES `.eq`, conferidas contra a linha que existe
        // agora. Antes ele devolvia um `estado.linhasAfetadas` que ninguém
        // conectava à realidade: o teste do "UPDATE que não pega linha" acionava
        // um botão do próprio mock, e por isso não podia falhar pelo motivo
        // certo — o mock provando a si mesmo, a lição registrada no Bloco 4B.
        const linha = estado.linha as Record<string, unknown> | null;
        const casou = linha !== null
          && chamada.eq.every(([col, val]) => linha[col as string] === val);
        if (!casou) return { data: chamada.select.length ? [] : null, error: null };

        Object.assign(linha, valores);
        if (chamada.select.length === 0) return { data: null, error: null };
        return { data: [{ id: linha.id }], error: null };
      }

      // FIEL AO supabase-js: sem `.select()`, `data` volta null.
      if (chamada.select.length === 0) return { data: null, error: null };
      return { data: estado.linhasAfetadas, error: null };
    };
    const b = {
      eq: (c: unknown, v: unknown) => { chamada.eq.push([c, v]); return b; },
      select: (cols: string) => { chamada.select.push(cols); return b; },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, falhou),
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        maybeSingle: async () => ({
          data: estado.erroLeitura ? null : estado.linha,
          error: estado.erroLeitura,
        }),
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => construir(tabela, 'update', valores),
    insert: (valores: Record<string, unknown>) => construir(tabela, 'insert', valores),
  }));

  const registrarAuditoria = vi.fn(
    async (e: { acao: string; alvoId?: string | null; meta?: Record<string, unknown> }) => {
      auditorias.push(e);
    },
  );
  const revalidatePath = vi.fn((_p: string) => {});
  const gerarTexto = vi.fn(async (cfg: Record<string, unknown>, prompt: string) => {
    configsUsadas.push(cfg);
    prompts.push(prompt);
    if (estado.erroIa) throw estado.erroIa;
    return 'ok';
  });

  return { updates, inserts, auditorias, prompts, configsUsadas, estado, from, registrarAuditoria, revalidatePath, gerarTexto };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/ai/cliente', () => ({ gerarTexto: h.gerarTexto }));

import { salvarConfigIaAction, testarConexaoIaAction } from './actions';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.prompts.length = 0;
  h.configsUsadas.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.linha = { id: 1, provedor: 'openai', modelo: 'gpt-4o-mini', base_url: null, chave_cifrada: null };
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.linhasAfetadas = [{ id: 1 }];
  h.estado.erroIa = null;
  h.estado.aoAplicar = null;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.gerarTexto.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const entrada = (over: Record<string, unknown> = {}) => ({
  provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave: '', ...over,
});

describe('salvarConfigIaAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarConfigIaAction(entrada());
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  // A INVARIANTE Nº 1. O campo da chave vem VAZIO toda vez que o admin só quer
  // trocar o modelo — e nesse caminho a coluna do segredo não pode ser tocada.
  // Um `upsert` (que era o que o plano pedia) mandaria NULL nela.
  it('salvar sem chave nova NÃO toca na coluna da chave', async () => {
    h.estado.linha = { id: 1, chave_cifrada: 'enc:v1:qualquer' };
    const r = await salvarConfigIaAction(entrada({ modelo: 'outro-modelo' }));
    expect(r).toEqual({ ok: true });
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0].valores)).not.toContain('chave_cifrada');
    // e é UPDATE, não INSERT: a linha já existia.
    expect(h.inserts).toHaveLength(0);
    expect(h.updates[0].eq).toContainEqual(['id', 1]);
  });

  it('a chave nova vai para a coluna CIFRADA, e decifra de volta', async () => {
    const r = await salvarConfigIaAction(entrada({ chave: CHAVE_FALSA }));
    expect(r).toEqual({ ok: true });
    const gravada = h.updates[0].valores.chave_cifrada as string;
    expect(gravada.startsWith('enc:v1:')).toBe(true);
    expect(gravada).not.toContain(CHAVE_FALSA);
    expect(lerChaveIa(gravada)).toBe(CHAVE_FALSA);
  });

  it('a chave NUNCA volta no retorno da action', async () => {
    const r = await salvarConfigIaAction(entrada({ chave: CHAVE_FALSA }));
    expect(JSON.stringify(r)).not.toContain(CHAVE_FALSA);
    expect(JSON.stringify(r)).not.toContain('enc:v1:');
  });

  // Máscara em log é chave pela metade. O que interessa auditar é quem trocou.
  it('a auditoria não carrega a chave, nem mascarada', async () => {
    await salvarConfigIaAction(entrada({ chave: CHAVE_FALSA }));
    const ev = h.auditorias.find((a) => a.acao === 'ia.config_salvar');
    expect(ev).toBeTruthy();
    const serializado = JSON.stringify(ev);
    expect(serializado).not.toContain(CHAVE_FALSA);
    expect(serializado).not.toContain(CHAVE_FALSA.slice(0, 8));
    expect(serializado).not.toContain('enc:v1:');
    expect(ev?.meta?.trocou_chave).toBe(true);
  });

  // CONSERTO 3 (Bloco 5 produção fiscal): `audit_log.alvo_id` é uuid — passar
  // a string `'1'` fazia o insert falhar em silêncio (erro de sintaxe), e
  // NENHUMA troca de config_ia jamais foi registrada. O identificador do
  // singleton vai para o `meta`, não para `alvoId`.
  it('alvoId nunca é a string não-uuid "1" — vai null, e o id do singleton mora no meta', async () => {
    await salvarConfigIaAction(entrada({ chave: CHAVE_FALSA }));
    const ev = h.auditorias.find((a) => a.acao === 'ia.config_salvar');
    expect(ev?.alvoId).toBeNull();
    expect(ev?.meta?.config_id).toBe(1);
  });

  it('personalizado sem base_url é recusado ANTES de gravar', async () => {
    const r = await salvarConfigIaAction(entrada({ provedor: 'personalizado', base_url: '' }));
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('personalizado com http:// é recusado — a chave viaja no cabeçalho', async () => {
    const r = await salvarConfigIaAction(
      entrada({ provedor: 'personalizado', base_url: 'http://inseguro.invalido/v1' }));
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('provedor fora da lista é recusado', async () => {
    const r = await salvarConfigIaAction(entrada({ provedor: 'provedor-inventado' }));
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  // Sobra de configuração anterior não pode continuar valendo.
  it('trocar de personalizado para um provedor conhecido zera a base_url', async () => {
    await salvarConfigIaAction(entrada({ provedor: 'anthropic', base_url: 'https://sobrou.invalido/v1' }));
    expect(h.updates[0].valores.base_url).toBeNull();
  });

  it('tabela vazia: INSERT com id 1, e não UPDATE', async () => {
    h.estado.linha = null;
    const r = await salvarConfigIaAction(entrada());
    expect(r).toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores.id).toBe(1);
    expect(h.updates).toHaveLength(0);
  });

  // Sem o `.select('id')`, o PostgREST devolve sucesso para um UPDATE que não
  // pegou linha nenhuma — e a tela diria "salvo" sobre coisa nenhuma.
  // O cenário é a linha SUMIR entre a leitura e a escrita. A versão anterior
  // deste teste zerava um `linhasAfetadas` do mock — botão desligado da
  // realidade, incapaz de falhar pelo motivo certo.
  it('UPDATE que não pega linha nenhuma não é reportado como salvo', async () => {
    h.estado.aoAplicar = () => { h.estado.linha = null; };
    const r = await salvarConfigIaAction(entrada());
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.erroEscrita = { message: 'boom' };
    const r = await salvarConfigIaAction(entrada());
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('testarConexaoIaAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await testarConexaoIaAction();
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  it('sem chave gravada, nem tenta a rede', async () => {
    h.estado.linha = { id: 1, provedor: 'groq', modelo: 'm', base_url: null, chave_cifrada: null };
    const r = await testarConexaoIaAction();
    expect(r.ok).toBe(false);
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  // `lerChaveIa` LANÇA em gravação corrompida. Fora de um `try`, isto derrubaria
  // a action inteira e a tela veria um erro genérico de servidor.
  it('chave corrompida vira mensagem legível, não exceção', async () => {
    h.estado.linha = { id: 1, provedor: 'groq', modelo: 'm', base_url: null, chave_cifrada: 'em-claro-sem-prefixo' };
    const r = await testarConexaoIaAction();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/corrompida/i);
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  it('com chave gravada, decifra e chama o provedor com o prompt constante', async () => {
    const { guardarChaveIa } = await import('@/lib/ai/config-ia');
    h.estado.linha = {
      id: 1, provedor: 'groq', modelo: 'llama', base_url: null,
      chave_cifrada: guardarChaveIa(CHAVE_FALSA),
    };
    const r = await testarConexaoIaAction();
    expect(r).toEqual({ ok: true });
    expect(h.configsUsadas[0].chave).toBe(CHAVE_FALSA);
    // O prompt do teste é uma CONSTANTE do módulo: nenhum dado de contribuinte
    // tem como entrar nele.
    expect(h.prompts[0]).toBe('Responda apenas: ok');
    // CONSERTO 3: mesmo defeito do alvoId '1' existia aqui também.
    const ev = h.auditorias.find((a) => a.acao === 'ia.testar_conexao');
    expect(ev?.alvoId).toBeNull();
    expect(ev?.meta?.config_id).toBe(1);
  });

  it('erro do provedor não carrega a chave na mensagem', async () => {
    const { guardarChaveIa } = await import('@/lib/ai/config-ia');
    h.estado.linha = {
      id: 1, provedor: 'groq', modelo: 'llama', base_url: null,
      chave_cifrada: guardarChaveIa(CHAVE_FALSA),
    };
    h.estado.erroIa = new Error(`401 invalid key ${CHAVE_FALSA}`);
    const r = await testarConexaoIaAction();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('401');
      expect(r.error).not.toContain(CHAVE_FALSA);
    }
  });
});
