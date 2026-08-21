// 0094/0095/0099 — a rede das invariantes dos tokens (hom/prod) da Focus.
//
// Cada teste aqui morde uma mudança que hoje passa por `tsc --noEmit` e pelo
// resto da suíte:
//   1. gravar algum token em claro, ou deixar `guardarTokenFocus` falhar calado;
//   2. devolver o token (ou a coluna cifrada) para a tela;
//   3. mandar o token — inteiro ou mascarado — para a auditoria;
//   4. tratar UPDATE que não pegou linha nenhuma como sucesso;
//   5. sondar `/v2/empresas` em vez do catálogo — o defeito que a 0099 desfaz:
//      essa conta leva 401 em `/v2/empresas` NOS DOIS AMBIENTES, para os dois
//      tokens corretos, por falta de permissão da CONTA — sondar por ali
//      recusaria tokens certos;
//   6. gravar metade de uma troca quando o outro token é recusado.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria, `next/cache` e o
// cliente da Focus. Não há rede nem banco. A cifra é a DE VERDADE, com uma
// CERT_ENC_KEY de teste — é o único jeito de provar que o que vai para a coluna
// está cifrado e não em claro.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerTokenFocus } from '@/lib/fiscal/config-focus';

const USER_ID = 'user_admin_1';
// Valores obviamente falsos: nenhum token real deve existir num fixture.
const TOKEN_HOM = 'TESTE-hom-obviamente-falso-0001';
const TOKEN_PROD = 'TESTE-prod-obviamente-falso-0001';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const updates: Chamada[] = [];
  const inserts: Chamada[] = [];
  const auditorias: Array<{ acao: string; alvoId?: string | null; meta?: Record<string, unknown> }> = [];
  // Cada chamada de sonda: código do CNAE, ambiente e o tokenOverride usado.
  const sondas: Array<{ codigo: string; env?: string; tokenOverride?: string }> = [];

  const estado = {
    // Literal, e não `USER_ID`: este factory é IÇADO acima das consts do
    // módulo e não enxerga nenhuma delas.
    guard: { userId: 'user_admin_1' } as unknown,
    linha: null as Record<string, unknown> | null,
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    // Erro que a sonda deve lançar por ambiente. `undefined` = sucesso.
    erroFocusHom: null as unknown,
    erroFocusProd: null as unknown,
  };

  function construir(tabela: string, kind: 'update' | 'insert', valores: Record<string, unknown>) {
    const chamada: Chamada = { tabela, valores, eq: [], select: [] };
    (kind === 'update' ? updates : inserts).push(chamada);
    const resultado = () => {
      if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };

      if (kind === 'update') {
        // O MOCK HONRA AS CONDIÇÕES `.eq` contra a linha que existe agora, em
        // vez de devolver um número que o teste escolheu. Sem isso o teste do
        // "UPDATE que não pega linha" acionaria um botão do próprio mock — o
        // mock provando a si mesmo, a lição registrada no Bloco 4B.
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
      return { data: [{ id: 1 }], error: null };
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
  const consultarCnae = vi.fn(async (codigo: string, env?: string, tokenOverride?: string) => {
    sondas.push({ codigo, env, tokenOverride });
    const erro = env === 'hom' ? estado.erroFocusHom : estado.erroFocusProd;
    if (erro) throw erro;
    return {};
  });

  return {
    updates, inserts, auditorias, sondas, estado,
    from, registrarAuditoria, revalidatePath, consultarCnae,
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/clients/focus-nfe', () => ({ focus: { consultarCnae: h.consultarCnae } }));

import { salvarConfigFocusAction, testarConexaoFocusAction, limparConfigFocusAction } from './actions';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.sondas.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.linha = { id: 1, token_hom_cifrado: null, token_prod_cifrado: null };
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.erroFocusHom = null;
  h.estado.erroFocusProd = null;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.consultarCnae.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('salvarConfigFocusAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('os dois campos vazios NÃO grava nada', async () => {
    // Sem isto o "salvar" em branco atualizaria só o carimbo de data e diria
    // "salvo" — o admin sairia achando que trocou algum dos tokens.
    const r = await salvarConfigFocusAction({ token_hom: '   ', token_prod: '' });
    expect(r).toEqual({ ok: false, error: 'Cole ao menos um token (homologação ou produção) para salvar.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('só o token de homologação: sonda só hom, grava só a coluna hom', async () => {
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(r).toEqual({ ok: true });

    expect(h.sondas).toEqual([{ codigo: '6201501', env: 'hom', tokenOverride: TOKEN_HOM }]);

    const v = h.updates[0].valores;
    expect(v.token_hom_cifrado).toMatch(/^enc:v1:/);
    expect(v).not.toHaveProperty('token_prod_cifrado');
    expect(lerTokenFocus(v.token_hom_cifrado as string)).toBe(TOKEN_HOM);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates[0].eq).toContainEqual(['id', 1]);
  });

  it('só o token de produção: sonda só prod, grava só a coluna prod', async () => {
    const r = await salvarConfigFocusAction({ token_prod: TOKEN_PROD });
    expect(r).toEqual({ ok: true });

    expect(h.sondas).toEqual([{ codigo: '6201501', env: 'prod', tokenOverride: TOKEN_PROD }]);

    const v = h.updates[0].valores;
    expect(v.token_prod_cifrado).toMatch(/^enc:v1:/);
    expect(v).not.toHaveProperty('token_hom_cifrado');
    expect(lerTokenFocus(v.token_prod_cifrado as string)).toBe(TOKEN_PROD);
  });

  it('os dois campos preenchidos: sonda os dois, grava os dois cifrados', async () => {
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD });
    expect(r).toEqual({ ok: true });

    expect(h.sondas).toHaveLength(2);
    expect(h.sondas).toEqual(
      expect.arrayContaining([
        { codigo: '6201501', env: 'hom', tokenOverride: TOKEN_HOM },
        { codigo: '6201501', env: 'prod', tokenOverride: TOKEN_PROD },
      ]),
    );

    const v = h.updates[0].valores;
    expect(lerTokenFocus(v.token_hom_cifrado as string)).toBe(TOKEN_HOM);
    expect(lerTokenFocus(v.token_prod_cifrado as string)).toBe(TOKEN_PROD);
    expect(String(v.token_hom_cifrado)).not.toContain(TOKEN_HOM);
    expect(String(v.token_prod_cifrado)).not.toContain(TOKEN_PROD);
    expect(h.inserts).toHaveLength(0);
  });

  it('a auditoria não carrega nenhum dos tokens, nem mascarado', async () => {
    await salvarConfigFocusAction({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD });
    expect(h.auditorias).toHaveLength(1);
    const serializada = JSON.stringify(h.auditorias[0]);
    expect(serializada).not.toContain(TOKEN_HOM);
    expect(serializada).not.toContain(TOKEN_PROD);
    // Máscara em log é segredo pela metade: nem os primeiros caracteres.
    expect(serializada).not.toContain(TOKEN_HOM.slice(0, 8));
    expect(h.auditorias[0].meta).toEqual({
      config_id: 1,
      trocou_hom: true,
      trocou_prod: true,
      sonda_hom: 'aceito',
      sonda_prod: 'aceito',
    });
  });

  it('meta registra qual dos dois trocou quando só um veio preenchido', async () => {
    await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(h.auditorias[0].meta).toEqual({
      config_id: 1,
      trocou_hom: true,
      trocou_prod: false,
      sonda_hom: 'aceito',
      sonda_prod: null,
    });
  });

  // CONSERTO 3 (Bloco 5 produção fiscal): `audit_log.alvo_id` é uuid — a
  // string `'1'` fazia o insert falhar em silêncio.
  it('alvoId nunca é a string não-uuid "1" — vai null, e o id do singleton mora no meta', async () => {
    await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(h.auditorias[0].alvoId).toBeNull();
    expect(h.auditorias[0].meta?.config_id).toBe(1);
  });

  // ------------------------------------------------ CONSERTO 1: testar antes
  // de gravar, agora por ambiente. A 0099 desfaz a 0095: a sonda tem de bater
  // no catálogo (que discrimina por token) e NÃO em `/v2/empresas` (401 para
  // os dois tokens corretos, por permissão da conta).
  describe('CONSERTO 1 — sonda por ambiente antes de gravar', () => {
    it('sonda o token que ESTÁ SENDO SALVO na base do SEU ambiente, não o que já está no banco', async () => {
      await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
      expect(h.sondas).toEqual([{ codigo: '6201501', env: 'hom', tokenOverride: TOKEN_HOM }]);
    });

    it('401 no token de hom BLOQUEIA a gravação — nem o de prod é gravado', async () => {
      h.estado.erroFocusHom = new Error('Focus GET /v2/codigos_cnae/6201501 → 401: denied');
      const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD });
      expect(r.ok).toBe(false);
      expect('error' in r && r.error).toMatch(/homologa/i);
      // NADA foi persistido nem auditado — nem o token de prod, que teria
      // passado na sonda dele.
      expect(h.updates).toHaveLength(0);
      expect(h.inserts).toHaveLength(0);
      expect(h.auditorias).toHaveLength(0);
    });

    it('403 no token de prod também bloqueia — nem o de hom é gravado', async () => {
      h.estado.erroFocusProd = new Error('Focus GET /v2/codigos_cnae/6201501 → 403: forbidden');
      const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD });
      expect(r.ok).toBe(false);
      expect('error' in r && r.error).toMatch(/produ/i);
      expect(h.updates).toHaveLength(0);
    });

    it('sonda indeterminada (rede/5xx/timeout) NÃO bloqueia — grava mesmo assim, com aviso', async () => {
      // Não dá para impedir alguém de configurar uma credencial nova só
      // porque a Focus está instável no momento do salvamento.
      h.estado.erroFocusHom = new Error('Focus GET /v2/codigos_cnae/6201501 → 500: boom');
      const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
      expect(r.ok).toBe(true);
      expect('aviso' in r && r.aviso).toMatch(/não foi possível confirmar/i);
      expect('aviso' in r && r.aviso).toMatch(/homologa/i);
      expect(h.updates).toHaveLength(1);
      expect(h.auditorias).toHaveLength(1);
    });

    it('timeout/erro de rede sem status também é indeterminado, não bloqueia', async () => {
      h.estado.erroFocusProd = new Error('ETIMEDOUT');
      const r = await salvarConfigFocusAction({ token_prod: TOKEN_PROD });
      expect(r.ok).toBe(true);
      expect('aviso' in r && r.aviso).toBeTruthy();
    });

    it('um indeterminado e o outro aceito: grava os dois, aviso menciona só o indeterminado', async () => {
      h.estado.erroFocusHom = new Error('ETIMEDOUT');
      const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD });
      expect(r.ok).toBe(true);
      expect('aviso' in r && r.aviso).toMatch(/homologa/i);
      expect('aviso' in r && r.aviso).not.toMatch(/produ/i);
      const v = h.updates[0].valores;
      expect(v.token_hom_cifrado).toBeTruthy();
      expect(v.token_prod_cifrado).toBeTruthy();
    });
  });

  it('sem linha no banco, INSERE com id=1', async () => {
    h.estado.linha = null;
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(r).toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores.id).toBe(1);
  });

  it('UPDATE que não pegou linha nenhuma NÃO é sucesso', async () => {
    // Zero linhas afetadas é a falha mais enganosa do PostgREST: sem o
    // `.select('id')`, ele devolve sucesso. A lição está registrada em
    // `fix(seguranca): zero linhas afetadas deixa de ser lido como sucesso`.
    h.estado.linha = { id: 99, token_hom_cifrado: null, token_prod_cifrado: null };
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(r.ok).toBe(false);
  });

  it('erro de leitura não vira gravação', async () => {
    h.estado.erroLeitura = { message: 'schema cache' };
    const r = await salvarConfigFocusAction({ token_hom: TOKEN_HOM });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });
});

describe('testarConexaoFocusAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await testarConexaoFocusAction('hom');
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.sondas).toHaveLength(0);
  });

  // A INVARIANTE Nº 5: a sonda tem de bater no catálogo, não em /v2/empresas.
  it('sonda /v2/codigos_cnae no ambiente pedido, sem tokenOverride (usa o gravado)', async () => {
    await testarConexaoFocusAction('prod');
    expect(h.consultarCnae).toHaveBeenCalledTimes(1);
    expect(h.sondas).toEqual([{ codigo: '6201501', env: 'prod', tokenOverride: undefined }]);
  });

  it('hom e prod sondam ambientes diferentes', async () => {
    await testarConexaoFocusAction('hom');
    await testarConexaoFocusAction('prod');
    expect(h.sondas.map((s) => s.env)).toEqual(['hom', 'prod']);
  });

  it('401 é lido como token sem acesso NAQUELE ambiente', async () => {
    h.estado.erroFocusHom = new Error('Focus GET /v2/codigos_cnae/6201501 → 401: denied');
    const r = await testarConexaoFocusAction('hom');
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/homologa/i);
  });

  // O CONTRÁRIO DISSO É O DEFEITO: ler 5xx/timeout como "token inválido"
  // mandaria o admin trocar uma credencial que estava certa.
  it('erro que NÃO é 401/403 diz explicitamente que o token não foi recusado', async () => {
    h.estado.erroFocusProd = new Error('Focus GET /v2/codigos_cnae/6201501 → 500: boom');
    const r = await testarConexaoFocusAction('prod');
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/não recusou o token/);
  });
});

// CONSERTO 2 (Bloco 5 produção fiscal): antes disto não existia caminho pela
// interface para desfazer uma gravação ruim — campo vazio sempre significou
// "não trocar", nunca "apagar".
describe('limparConfigFocusAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await limparConfigFocusAction();
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
  });

  it('grava NULL nas DUAS colunas cifradas — volta o app ao fallback de ambiente', async () => {
    h.estado.linha = { id: 1, token_hom_cifrado: 'enc:v1:algumacoisa', token_prod_cifrado: 'enc:v1:outracoisa' };
    const r = await limparConfigFocusAction();
    expect(r).toEqual({ ok: true });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].valores.token_hom_cifrado).toBeNull();
    expect(h.updates[0].valores.token_prod_cifrado).toBeNull();
    expect(h.updates[0].eq).toContainEqual(['id', 1]);
  });

  it('audita a limpeza com alvoId null e o id do singleton no meta', async () => {
    h.estado.linha = { id: 1, token_hom_cifrado: 'enc:v1:algumacoisa', token_prod_cifrado: null };
    await limparConfigFocusAction();
    expect(h.auditorias).toHaveLength(1);
    expect(h.auditorias[0].acao).toBe('focus.config_limpar');
    expect(h.auditorias[0].alvoId).toBeNull();
    expect(h.auditorias[0].meta).toEqual({ config_id: 1 });
  });

  it('linha não encontrada devolve erro, não sucesso silencioso', async () => {
    h.estado.linha = null;
    const r = await limparConfigFocusAction();
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.linha = { id: 1, token_hom_cifrado: 'enc:v1:algumacoisa', token_prod_cifrado: null };
    h.estado.erroEscrita = { message: 'boom' };
    const r = await limparConfigFocusAction();
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });
});
