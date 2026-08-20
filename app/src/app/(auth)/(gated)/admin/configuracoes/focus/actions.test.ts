// 0094/0095 — a rede das invariantes do token de revenda da Focus.
//
// Cada teste aqui morde uma mudança que hoje passa por `tsc --noEmit` e pelo
// resto da suíte:
//   1. gravar o token em claro, ou deixar `guardarTokenFocus` falhar calado;
//   2. devolver o token (ou a coluna cifrada) para a tela;
//   3. mandar o token — inteiro ou mascarado — para a auditoria;
//   4. tratar UPDATE que não pegou linha nenhuma como sucesso;
//   5. sondar o CATÁLOGO em vez da REVENDA — o defeito que a sondagem de
//      20/08/2026 achou: os tokens do `.env.local` dão 200 em
//      `/v2/codigos_cnae` e 401 em `/v2/empresas`, então testar pelo catálogo
//      aprovaria um token que não serve para nada que a tela promete;
//   6. ler 404 como falha — na revenda, 404 num id que não é nosso é a
//      resposta de um token VÁLIDO.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria, `next/cache` e o
// cliente da Focus. Não há rede nem banco. A cifra é a DE VERDADE, com uma
// CERT_ENC_KEY de teste — é o único jeito de provar que o que vai para a coluna
// está cifrado e não em claro.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerTokenFocus } from '@/lib/fiscal/config-focus';

const USER_ID = 'user_admin_1';
// Valor obviamente falso: nenhum token real deve existir num fixture.
const TOKEN = 'TESTE-revenda-obviamente-falso-0001';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const updates: Chamada[] = [];
  const inserts: Chamada[] = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> }> = [];
  const sondas: number[] = [];

  const estado = {
    // Literal, e não `USER_ID`: este factory é IÇADO acima das consts do
    // módulo e não enxerga nenhuma delas.
    guard: { userId: 'user_admin_1' } as unknown,
    linha: null as Record<string, unknown> | null,
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    erroFocus: null as unknown,
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

  const registrarAuditoria = vi.fn(async (e: { acao: string; meta?: Record<string, unknown> }) => {
    auditorias.push(e);
  });
  const revalidatePath = vi.fn((_p: string) => {});
  const consultarEmpresa = vi.fn(async (id: number) => {
    sondas.push(id);
    if (estado.erroFocus) throw estado.erroFocus;
    return {};
  });

  return { updates, inserts, auditorias, sondas, estado, from, registrarAuditoria, revalidatePath, consultarEmpresa };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/clients/focus-nfe', () => ({ focus: { consultarEmpresa: h.consultarEmpresa } }));

import { salvarConfigFocusAction, testarConexaoFocusAction } from './actions';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.sondas.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.linha = { id: 1, token_revenda_cifrado: null };
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.erroFocus = null;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.consultarEmpresa.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('salvarConfigFocusAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('campo vazio NÃO grava nada', async () => {
    // Sem isto o "salvar" em branco atualizaria só o carimbo de data e diria
    // "salvo" — o admin sairia achando que trocou o token.
    const r = await salvarConfigFocusAction({ token_revenda: '   ' });
    expect(r).toEqual({ ok: false, error: 'Cole o token de revenda para salvar.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('o token vai para a coluna CIFRADA, e decifra de volta', async () => {
    const r = await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(r).toEqual({ ok: true });

    const v = h.updates[0].valores;
    expect(v.token_revenda_cifrado).toMatch(/^enc:v1:/);
    expect(String(v.token_revenda_cifrado)).not.toContain(TOKEN);
    expect(lerTokenFocus(v.token_revenda_cifrado as string)).toBe(TOKEN);
    // e é UPDATE, não INSERT: a linha já existia.
    expect(h.inserts).toHaveLength(0);
    expect(h.updates[0].eq).toContainEqual(['id', 1]);
  });

  it('a auditoria não carrega o token, nem mascarado', async () => {
    await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(h.auditorias).toHaveLength(1);
    const serializada = JSON.stringify(h.auditorias[0]);
    expect(serializada).not.toContain(TOKEN);
    // Máscara em log é segredo pela metade: nem os primeiros caracteres.
    expect(serializada).not.toContain(TOKEN.slice(0, 8));
    expect(h.auditorias[0].meta).toEqual({ trocou_token: true });
  });

  it('sem linha no banco, INSERE com id=1', async () => {
    h.estado.linha = null;
    const r = await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(r).toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores.id).toBe(1);
  });

  it('UPDATE que não pegou linha nenhuma NÃO é sucesso', async () => {
    // Zero linhas afetadas é a falha mais enganosa do PostgREST: sem o
    // `.select('id')`, ele devolve sucesso. A lição está registrada em
    // `fix(seguranca): zero linhas afetadas deixa de ser lido como sucesso`.
    h.estado.linha = { id: 99, token_revenda_cifrado: null };
    const r = await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(r.ok).toBe(false);
  });

  it('erro de leitura não vira gravação', async () => {
    h.estado.erroLeitura = { message: 'schema cache' };
    const r = await salvarConfigFocusAction({ token_revenda: TOKEN });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });
});

describe('testarConexaoFocusAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await testarConexaoFocusAction();
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.sondas).toHaveLength(0);
  });

  // A INVARIANTE Nº 5: a sonda tem de bater na REVENDA.
  it('sonda /v2/empresas, não o catálogo de CNAEs', async () => {
    await testarConexaoFocusAction();
    expect(h.consultarEmpresa).toHaveBeenCalledTimes(1);
    expect(h.sondas).toEqual([1]);
  });

  it('404 é SUCESSO — o token entrou na revenda e não achou o id, que é o esperado', async () => {
    h.estado.erroFocus = new Error('Focus GET /v2/empresas/1 → 404: not found');
    const r = await testarConexaoFocusAction();
    expect(r).toEqual({ ok: true });
  });

  it('401 é lido como token sem acesso à revenda', async () => {
    h.estado.erroFocus = new Error('Focus GET /v2/empresas/1 → 401: denied');
    const r = await testarConexaoFocusAction();
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/revenda/);
  });

  // O CONTRÁRIO DISSO É O DEFEITO: ler 5xx/timeout como "token inválido"
  // mandaria o admin trocar uma credencial que estava certa.
  it('erro que NÃO é 401/403/404 diz explicitamente que o token não foi recusado', async () => {
    h.estado.erroFocus = new Error('Focus GET /v2/empresas/1 → 500: boom');
    const r = await testarConexaoFocusAction();
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/não recusou o token/);
  });
});
