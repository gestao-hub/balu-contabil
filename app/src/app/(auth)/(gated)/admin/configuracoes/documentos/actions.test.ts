// Documentos legais — a rede das invariantes das actions de AdminBalu.
//
// Cada teste aqui existe para MORDER uma mudança específica:
//   1. voltar a recusar "salvar" sobre versão publicada (a recusa era certa
//      antes do lançamento; a decisão de 20/08/2026 trocou isso — ver o
//      comentário no topo de `actions.ts`);
//   2. "salvar" criar uma linha NOVA em vez de fazer UPDATE na existente;
//   3. "salvar" tocar em `publicado_em` (não pode, nunca);
//   4. "salvar como nova versão" reescrever a linha atual em vez de criar uma
//      linha nova com `publicado_em: null`, ou aceitar um número já usado;
//   5. "publicar" gravar por cima de algo já publicado, ou publicar sem
//      checar que a linha ainda está como rascunho no momento do UPDATE;
//   6. a auditoria perder o rastro de quantos aceites existiam no momento de
//      uma reescrita, ou mandar `alvoId` como string não-uuid (o defeito que
//      um commit de hoje corrigiu nas outras actions do admin).
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria e `next/cache`. Sem
// rede nem banco. O mock honra os `.eq`/`.is` contra o estado — não é um
// botão que o próprio teste aciona (lição registrada no Bloco 4B / 6A).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'user_admin_1';

type Filtro = ['eq' | 'is', string, unknown];
type ChamadaEscrita = {
  tabela: string;
  kind: 'update' | 'insert';
  valores: Record<string, unknown>;
  eq: [string, unknown][];
  isNull: string[];
  select: string[];
};

const h = vi.hoisted(() => {
  const updates: ChamadaEscrita[] = [];
  const inserts: ChamadaEscrita[] = [];
  const auditorias: Array<{ acao: string; alvoTipo?: string; alvoId?: string | null; meta?: Record<string, unknown> }> = [];

  const estado = {
    // Literal, e não `USER_ID`: este factory é IÇADO acima das consts do
    // módulo. O `beforeEach` reatribui com a const.
    guard: { userId: 'user_admin_1' } as unknown,
    /** `documento_versoes` hoje no banco. */
    linhas: [] as Record<string, unknown>[],
    /** `aceites` hoje no banco — só os campos que a contagem usa. */
    aceites: [] as { tipo: string; versao: string }[],
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    /** Roda no INÍCIO do UPDATE, depois da leitura já ter acontecido —
     *  simula a linha sumir entre a leitura e a escrita. */
    aoAplicarUpdate: null as null | (() => void),
    proximoId: 1,
  };

  function casaFiltros(linha: Record<string, unknown>, filtros: Filtro[]) {
    return filtros.every(([tipo, col, val]) =>
      tipo === 'eq' ? linha[col] === val : linha[col] == null);
  }

  function selectBuilder(tabela: string, opts?: { count?: 'exact'; head?: boolean }) {
    const filtros: Filtro[] = [];
    const contando = opts?.count === 'exact';
    const fonte = () => (tabela === 'documento_versoes' ? estado.linhas : estado.aceites);

    const b = {
      eq(col: string, val: unknown) { filtros.push(['eq', col, val]); return b; },
      is(col: string, val: unknown) { filtros.push(['is', col, val]); return b; },
      async maybeSingle() {
        if (estado.erroLeitura) return { data: null, error: estado.erroLeitura };
        const linha = fonte().find((l) => casaFiltros(l, filtros)) ?? null;
        return { data: linha, error: null };
      },
      then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
        const resultado = () => {
          if (estado.erroLeitura) return { data: null, error: estado.erroLeitura, count: null };
          const linhas = fonte().filter((l) => casaFiltros(l as Record<string, unknown>, filtros));
          if (contando) return { data: null, error: null, count: linhas.length };
          return { data: linhas, error: null, count: null };
        };
        return Promise.resolve(resultado()).then(ok, falhou);
      },
    };
    return b;
  }

  function writeBuilder(tabela: string, kind: 'update' | 'insert', valores: Record<string, unknown>) {
    const filtros: Filtro[] = [];
    let selectCols: string[] = [];

    function ejecutar() {
      if (kind === 'update') {
        estado.aoAplicarUpdate?.();
        const chamada: ChamadaEscrita = {
          tabela, kind, valores,
          eq: filtros.filter(([t]) => t === 'eq').map(([, c, v]) => [c, v]),
          isNull: filtros.filter(([t]) => t === 'is').map(([, c]) => c),
          select: selectCols,
        };
        updates.push(chamada);

        if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };
        const linha = estado.linhas.find((l) => casaFiltros(l, filtros));
        if (!linha) return { data: selectCols.length ? [] : null, error: null };
        Object.assign(linha, valores);
        if (selectCols.length === 0) return { data: null, error: null };
        return { data: [{ id: linha.id }], error: null };
      }

      // insert
      const chamada: ChamadaEscrita = {
        tabela, kind, valores, eq: [], isNull: [], select: selectCols,
      };
      inserts.push(chamada);
      if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };
      const nova = { id: `nova-${estado.proximoId++}`, ...valores };
      estado.linhas.push(nova);
      if (selectCols.length === 0) return { data: null, error: null };
      return { data: [nova], error: null };
    }

    const b = {
      eq(col: string, val: unknown) { filtros.push(['eq', col, val]); return b; },
      is(col: string, val: unknown) { filtros.push(['is', col, val]); return b; },
      select(cols: string) { selectCols = [...selectCols, cols]; return b; },
      async single() {
        const r = ejecutar();
        if (r.error) return { data: null, error: r.error };
        const arr = (r.data ?? []) as Record<string, unknown>[];
        if (arr.length !== 1) return { data: null, error: { message: 'não retornou exatamente uma linha' } };
        return { data: arr[0], error: null };
      },
      then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
        return Promise.resolve(ejecutar()).then(ok, falhou);
      },
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string, opts?: { count?: 'exact'; head?: boolean }) => selectBuilder(tabela, opts),
    update: (valores: Record<string, unknown>) => writeBuilder(tabela, 'update', valores),
    insert: (valores: Record<string, unknown>) => writeBuilder(tabela, 'insert', valores),
  }));

  const registrarAuditoria = vi.fn(
    async (e: { acao: string; alvoTipo?: string; alvoId?: string | null; meta?: Record<string, unknown> }) => {
      auditorias.push(e);
    },
  );
  const revalidatePath = vi.fn((_p: string) => {});

  return { updates, inserts, auditorias, estado, from, registrarAuditoria, revalidatePath };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));

import { salvarDocumentoAction, salvarNovaVersaoDocumentoAction, publicarDocumentoAction } from './actions';

beforeEach(() => {
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.linhas = [
    { id: 'doc-privacidade-1', tipo: 'privacidade', versao: '1.0', conteudo_md: 'texto publicado', publicado_em: '2026-01-01T00:00:00Z' },
  ];
  h.estado.aceites = [];
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.aoAplicarUpdate = null;
  h.estado.proximoId = 1;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.from.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('salvarDocumentoAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
  });

  it('recusa dados inválidos (conteudo_md vazio) antes de qualquer escrita', async () => {
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: '   ' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('recusa versão com espaço', async () => {
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1. 0', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('recusa se a versão não existe', async () => {
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '9.9', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  // A INVARIANTE CENTRAL, pós-correção de escopo: salvar sobre a versão
  // PUBLICADA é permitido (pré-lançamento) — mas tem que ser UPDATE na linha
  // existente, nunca uma linha nova, e `publicado_em` não pode mudar.
  it('salvar sobre versão PUBLICADA faz UPDATE na linha existente, sem criar linha nova e sem mexer em publicado_em', async () => {
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'texto reescrito' });
    expect(r.ok).toBe(true);
    expect(h.updates).toHaveLength(1);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates[0].valores).toEqual({ conteudo_md: 'texto reescrito' });
    expect(h.updates[0].valores.publicado_em).toBeUndefined();
    const linha = h.estado.linhas.find((l) => l.id === 'doc-privacidade-1')!;
    expect(linha.conteudo_md).toBe('texto reescrito');
    expect(linha.publicado_em).toBe('2026-01-01T00:00:00Z');
  });

  it('salvar sobre rascunho existente faz UPDATE, não INSERT', async () => {
    h.estado.linhas.push({ id: 'doc-termos-rascunho', tipo: 'termos', versao: '2.0', conteudo_md: 'rascunho', publicado_em: null });
    const r = await salvarDocumentoAction({ tipo: 'termos', versao: '2.0', conteudo_md: 'rascunho editado' });
    expect(r.ok).toBe(true);
    expect(h.updates).toHaveLength(1);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates[0].eq).toContainEqual(['id', 'doc-termos-rascunho']);
  });

  it('devolve no resultado a contagem de aceites da versão salva', async () => {
    h.estado.aceites = [
      { tipo: 'privacidade', versao: '1.0' },
      { tipo: 'privacidade', versao: '1.0' },
      { tipo: 'privacidade', versao: '9.9' }, // outra versão, não conta
    ];
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r).toEqual({ ok: true, aceitesNaVersao: 2 });
  });

  it('sem aceites, salva sem exigir nada extra e devolve 0', async () => {
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r).toEqual({ ok: true, aceitesNaVersao: 0 });
  });

  // `alvo_id` é uuid — vai o `id` da linha, nunca uma string tipo/versão
  // (defeito já corrigido em `admin/configuracoes/ia/actions.ts`).
  it('auditoria: alvoId é o id (uuid) da linha, meta traz tipo, versão, estava_publicada e aceites_na_versao', async () => {
    h.estado.aceites = [{ tipo: 'privacidade', versao: '1.0' }];
    await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    const ev = h.auditorias.find((a) => a.acao === 'documentos.editar');
    expect(ev).toBeTruthy();
    expect(ev?.alvoId).toBe('doc-privacidade-1');
    expect(ev?.alvoTipo).toBe('documento_versoes');
    expect(ev?.meta).toEqual({
      tipo: 'privacidade', versao: '1.0', estava_publicada: true, aceites_na_versao: 1,
    });
  });

  it('rascunho editado: auditoria registra estava_publicada false', async () => {
    h.estado.linhas.push({ id: 'doc-termos-rascunho', tipo: 'termos', versao: '2.0', conteudo_md: 'rascunho', publicado_em: null });
    await salvarDocumentoAction({ tipo: 'termos', versao: '2.0', conteudo_md: 'y' });
    const ev = h.auditorias.find((a) => a.acao === 'documentos.editar');
    expect(ev?.meta?.estava_publicada).toBe(false);
  });

  it('erro de leitura não vira sucesso', async () => {
    h.estado.erroLeitura = { message: 'boom' };
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.erroEscrita = { message: 'boom' };
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  // A linha some entre a leitura e a escrita (ex.: apagada por outra sessão —
  // não há action de apagar, mas o UPDATE ainda precisa se defender).
  it('UPDATE que não pega linha nenhuma não é reportado como salvo', async () => {
    h.estado.aoAplicarUpdate = () => { h.estado.linhas = []; };
    const r = await salvarDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });
});

describe('salvarNovaVersaoDocumentoAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1.1', conteudo_md: 'x' });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.inserts).toHaveLength(0);
  });

  it('cria versão nova como INSERT com publicado_em: null', async () => {
    const r = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1.1', conteudo_md: 'texto novo' });
    expect(r).toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts[0].valores).toEqual({
      tipo: 'privacidade', versao: '1.1', conteudo_md: 'texto novo', publicado_em: null,
    });
    const criada = h.estado.linhas.find((l) => l.versao === '1.1');
    expect(criada).toBeTruthy();
    expect(criada?.publicado_em).toBeNull();
  });

  it('recusa se (tipo, versao) já existir — não sobrescreve a linha existente', async () => {
    const r = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1.0', conteudo_md: 'tentando sobrescrever' });
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
    const original = h.estado.linhas.find((l) => l.id === 'doc-privacidade-1')!;
    expect(original.conteudo_md).toBe('texto publicado');
  });

  it('recusa conteudo_md vazio', async () => {
    const r = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1.1', conteudo_md: '' });
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('recusa versão vazia ou com espaço', async () => {
    const r1 = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '', conteudo_md: 'x' });
    expect(r1.ok).toBe(false);
    const r2 = await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1. 1', conteudo_md: 'x' });
    expect(r2.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('recusa tipo fora de termos/privacidade', async () => {
    const r = await salvarNovaVersaoDocumentoAction({ tipo: 'cookies', versao: '1.0', conteudo_md: 'x' });
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('auditoria: alvoId é o id (uuid) da linha nova, meta traz tipo e versão', async () => {
    await salvarNovaVersaoDocumentoAction({ tipo: 'privacidade', versao: '1.1', conteudo_md: 'x' });
    const ev = h.auditorias.find((a) => a.acao === 'documentos.criar_versao');
    expect(ev).toBeTruthy();
    expect(ev?.alvoId).toBe('nova-1');
    expect(ev?.meta).toEqual({ tipo: 'privacidade', versao: '1.1' });
  });
});

describe('publicarDocumentoAction', () => {
  beforeEach(() => {
    h.estado.linhas.push({ id: 'doc-termos-rascunho', tipo: 'termos', versao: '2.0', conteudo_md: 'rascunho', publicado_em: null });
  });

  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await publicarDocumentoAction({ tipo: 'termos', versao: '2.0' });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
  });

  it('publica rascunho: grava publicado_em', async () => {
    const r = await publicarDocumentoAction({ tipo: 'termos', versao: '2.0' });
    expect(r).toEqual({ ok: true });
    const linha = h.estado.linhas.find((l) => l.id === 'doc-termos-rascunho')!;
    expect(linha.publicado_em).not.toBeNull();
    expect(typeof linha.publicado_em).toBe('string');
  });

  it('recusa se já publicado', async () => {
    const r = await publicarDocumentoAction({ tipo: 'privacidade', versao: '1.0' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    // permanece com a data original, não regravada
    expect(h.estado.linhas.find((l) => l.id === 'doc-privacidade-1')?.publicado_em).toBe('2026-01-01T00:00:00Z');
  });

  it('recusa se a versão não existe', async () => {
    const r = await publicarDocumentoAction({ tipo: 'termos', versao: '9.9' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('auditoria: alvoId é o id (uuid) da linha, meta traz tipo e versão', async () => {
    await publicarDocumentoAction({ tipo: 'termos', versao: '2.0' });
    const ev = h.auditorias.find((a) => a.acao === 'documentos.publicar');
    expect(ev).toBeTruthy();
    expect(ev?.alvoId).toBe('doc-termos-rascunho');
    expect(ev?.meta).toEqual({ tipo: 'termos', versao: '2.0' });
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.erroEscrita = { message: 'boom' };
    const r = await publicarDocumentoAction({ tipo: 'termos', versao: '2.0' });
    expect(r.ok).toBe(false);
    expect(h.auditorias).toHaveLength(0);
  });
});
