// Task 12 — Bloco 5: guarda de origem em `syncEmpresaNaFocus` (cadastro,
// POST /v2/empresas) e `atualizarEmpresaNaFocus` (atualização, PUT).
//
// POR QUE ESTE ARQUIVO EXISTE
// Com `empresas_fiscais.focus_origem = 'propria'`, a empresa traz a própria
// conta na Focus — Balu não cadastra, não atualiza e não sobe certificado
// (este último já coberto em cert-upload.test.ts). `criarEmpresa` e
// `atualizarEmpresa` autenticam com o TOKEN DE REVENDA da Balu (não o da
// empresa) — então, sem a guarda, os dois endpoints seriam alcançáveis e
// criariam/atualizariam um cadastro fantasma no tenant da Balu que não
// corresponde à conta que a empresa de fato usa para emitir.
//
// O que se prova aqui: com origem 'propria', a Focus NUNCA é chamada. Com
// origem 'balu' (ou sem linha em empresas_fiscais — default seguro), a guarda
// deixa passar — o teste usa um stub de `companies` que falha de propósito
// pra provar que o fluxo passou da guarda sem precisar montar o payload Focus
// inteiro.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

type CriarEmpresaResp = { id: number; token_homologacao?: string; token_producao?: string };

const h = vi.hoisted(() => ({
  criarEmpresa: vi.fn(async (): Promise<CriarEmpresaResp> => ({ id: 1, token_homologacao: 'tok-hom' })),
  atualizarEmpresa: vi.fn(async () => ({})),
  consultarEmpresa: vi.fn(async () => ({})),
}));

vi.mock('@/lib/clients/focus-nfe', () => ({
  focus: {
    criarEmpresa: h.criarEmpresa,
    atualizarEmpresa: h.atualizarEmpresa,
    consultarEmpresa: h.consultarEmpresa,
  },
}));

// Task 20.1 — `syncEmpresaNaFocus` grava os tokens SEMPRE com `createAdminClient()`,
// nunca com o client de sessão que o caller passa (`empresa_credenciais_focus` é
// fechada para `authenticated`, 0097). Mock isolado do de `@/lib/supabase/admin`
// pra capturar exatamente o que chega em `.upsert()`.
const hAdmin = vi.hoisted(() => ({
  upsertCalls: [] as Array<{ tabela: string; payload: Record<string, unknown>; opts: unknown }>,
  upsertError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      upsert: (payload: Record<string, unknown>, opts: unknown) => {
        hAdmin.upsertCalls.push({ tabela, payload, opts });
        return Promise.resolve(
          hAdmin.upsertError
            ? { data: null, error: hAdmin.upsertError }
            : { data: [{ empresa_id: payload.empresa_id }], error: null },
        );
      },
    }),
  }),
}));

// `@/lib/fiscal/credencial-empresa` NÃO é mockado — a cifra é a de verdade,
// mesmo molde de `focus-actions.test.ts` (Task 13): é o único jeito de provar
// que o valor que chega na coluna está cifrado de fato.
import { lerTokenEmpresa } from '@/lib/fiscal/credencial-empresa';
import { syncEmpresaNaFocus, atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';

type Result = { data: unknown; error: { message: string } | null };

/** Chain do Supabase: toda etapa devolve `this` (thenable) resolvendo pra `result`. */
function makeChain(result: Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => obj,
    single: () => obj,
    update: () => obj,
    then: (resolve: (v: Result) => void) => resolve(result),
  };
  return obj;
}

/**
 * `companies` sempre falha (de propósito): o que interessa nestes testes é só
 * o comportamento ANTES dessa consulta — se a guarda de origem bloqueou, ou
 * se deixou passar. Um round-trip completo até `focus.criarEmpresa` exigiria
 * montar o payload inteiro (endereço, regime, município), fora do escopo
 * desta guarda.
 */
function makeSupabase(focusOrigem: string | null) {
  return {
    from: (table: string) => {
      if (table === 'empresas_fiscais') {
        return makeChain({
          data: {
            focus_origem: focusOrigem,
            Code_regime_tributario: 'anexo3',
            empresa_fiscal_ativada: true,
            focus_empresa_id: 1,
            focus_codigo_municipio: null,
          },
          error: null,
        });
      }
      if (table === 'companies') {
        return makeChain({ data: null, error: { message: 'Empresa não encontrada (stub de teste).' } });
      }
      return makeChain({ data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  vi.clearAllMocks();
  hAdmin.upsertCalls.length = 0;
  hAdmin.upsertError = null;
});

describe('syncEmpresaNaFocus — Bloco 5: guarda de origem', () => {
  it("com focus_origem='propria', NÃO chama a Focus e devolve erro nomeado", async () => {
    const r = await syncEmpresaNaFocus(makeSupabase('propria'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/própria conta na Focus/);
    expect(h.criarEmpresa).not.toHaveBeenCalled();
  });

  it("com focus_origem='balu', a guarda deixa passar (segue pro fluxo existente)", async () => {
    const r = await syncEmpresaNaFocus(makeSupabase('balu'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
    expect(h.criarEmpresa).not.toHaveBeenCalled(); // barrado pelo stub de `companies`, não pela guarda
  });

  it('sem linha em empresas_fiscais (focus_origem null), default seguro é tratar como balu', async () => {
    const r = await syncEmpresaNaFocus(makeSupabase(null), 'empresa-1');
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
  });
});

describe('atualizarEmpresaNaFocus — Bloco 5: guarda de origem', () => {
  it("com focus_origem='propria', NÃO chama a Focus e devolve erro nomeado", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabase('propria'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/própria conta na Focus/);
    expect(h.atualizarEmpresa).not.toHaveBeenCalled();
  });

  it("com focus_origem='balu', a guarda deixa passar (segue pro fluxo existente)", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabase('balu'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
    expect(h.atualizarEmpresa).not.toHaveBeenCalled(); // barrado pelo stub de `companies`, não pela guarda
  });
});

// --- Task 20.1 — o POST devolve os dois tokens; os dois vão CIFRADOS, cada um
// na sua coluna, para `empresa_credenciais_focus` (0097). `companies.focus_token`
// não existe mais como destino de escrita: o sync antigo guardava
// `token_homologacao ?? token_producao` em texto puro ali, perdendo um dos dois
// tokens e repopulando a coluna que a migração de segurança tinha esvaziado. ---
describe('syncEmpresaNaFocus — Task 20.1: tokens vão para empresa_credenciais_focus', () => {
  const COMPANY_ID = 'empresa-happy-path';
  const TOKEN_HOM = 'TESTE-focus-hom-obviamente-falso-0001';
  const TOKEN_PROD = 'TESTE-focus-prod-obviamente-falso-0002';

  const COMPANY_ROW = {
    id: COMPANY_ID,
    cnpj: '12345678000123',
    razao_social: 'Acme Ltda',
    nome: 'Acme',
    logradouro: 'Rua Tal',
    numero: '100',
    sem_numero: false,
    complemento: null,
    bairro: 'Centro',
    municipio: 'Curitiba',
    uf: 'PR',
    cep: '80000000',
    email: null,
    telefone: null,
    inscricao_estadual: null,
    inscricao_municipal: null,
  };

  type ChamadaCompanies = { tabela: 'companies'; metodo: 'update'; payload: Record<string, unknown> };
  type ChamadaFiscais = { tabela: 'empresas_fiscais'; metodo: 'update'; payload: Record<string, unknown> };

  /** Client de SESSÃO (o que o caller real passa) — nunca deveria escrever em empresa_credenciais_focus. */
  function makeHappySupabase(focusOrigem: string | null = 'balu') {
    const chamadas: Array<ChamadaCompanies | ChamadaFiscais> = [];
    return {
      chamadas,
      from: (tabela: string) => {
        if (tabela === 'empresas_fiscais') {
          return {
            select: (cols: string) => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (cols.includes('focus_origem')) {
                    return { data: { focus_origem: focusOrigem }, error: null };
                  }
                  if (cols.includes('Code_regime_tributario')) {
                    return { data: { Code_regime_tributario: '1' }, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              chamadas.push({ tabela: 'empresas_fiscais', metodo: 'update', payload });
              return { eq: async () => ({ data: null, error: null }) };
            },
          };
        }
        if (tabela === 'companies') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { ...COMPANY_ROW }, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              chamadas.push({ tabela: 'companies', metodo: 'update', payload });
              return { eq: async () => ({ data: null, error: null }) };
            },
          };
        }
        throw new Error(`tabela inesperada no teste: ${tabela}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('grava os dois tokens CIFRADOS em empresa_credenciais_focus, cada um na sua coluna', async () => {
    h.criarEmpresa.mockResolvedValueOnce({
      id: 123,
      token_homologacao: TOKEN_HOM,
      token_producao: TOKEN_PROD,
    });

    const r = await syncEmpresaNaFocus(makeHappySupabase('balu'), COMPANY_ID);
    expect(r.ok).toBe(true);

    expect(hAdmin.upsertCalls).toHaveLength(1);
    const upsert = hAdmin.upsertCalls[0]!;
    expect(upsert.tabela).toBe('empresa_credenciais_focus');
    expect(upsert.payload.empresa_id).toBe(COMPANY_ID);

    // Cifrados de verdade — não o texto puro, e decifrando volta o original.
    expect(upsert.payload.token_hom_cifrado).toMatch(/^enc:v1:/);
    expect(upsert.payload.token_prod_cifrado).toMatch(/^enc:v1:/);
    expect(String(upsert.payload.token_hom_cifrado)).not.toContain(TOKEN_HOM);
    expect(String(upsert.payload.token_prod_cifrado)).not.toContain(TOKEN_PROD);
    expect(lerTokenEmpresa(upsert.payload.token_hom_cifrado as string)).toBe(TOKEN_HOM);
    expect(lerTokenEmpresa(upsert.payload.token_prod_cifrado as string)).toBe(TOKEN_PROD);
  });

  it('companies.update NUNCA recebe a chave focus_token — nem em texto puro, nem cifrada', async () => {
    h.criarEmpresa.mockResolvedValueOnce({
      id: 123,
      token_homologacao: TOKEN_HOM,
      token_producao: TOKEN_PROD,
    });

    const supabase = makeHappySupabase('balu');
    const r = await syncEmpresaNaFocus(supabase, COMPANY_ID);
    expect(r.ok).toBe(true);

    const updsCompanies = supabase.chamadas.filter(
      (c: { tabela: string }) => c.tabela === 'companies',
    ) as ChamadaCompanies[];
    expect(updsCompanies.length).toBeGreaterThan(0);
    for (const c of updsCompanies) {
      expect(c.payload).not.toHaveProperty('focus_token');
      const serializado = JSON.stringify(c.payload);
      expect(serializado).not.toContain(TOKEN_HOM);
      expect(serializado).not.toContain(TOKEN_PROD);
    }
    // O status final É 'ok' — a credencial foi salva com sucesso.
    const ultimoStatus = updsCompanies.find((c) => 'focus_status' in c.payload);
    expect(ultimoStatus?.payload.focus_status).toBe('ok');
  });

  it('o resultado nunca expõe o token em claro — SyncFocusResult.token é sempre null', async () => {
    h.criarEmpresa.mockResolvedValueOnce({
      id: 123,
      token_homologacao: TOKEN_HOM,
      token_producao: TOKEN_PROD,
    });
    const r = await syncEmpresaNaFocus(makeHappySupabase('balu'), COMPANY_ID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBeNull();
  });

  it('só um token vindo da Focus (ex: só homologação) grava só a coluna correspondente', async () => {
    h.criarEmpresa.mockResolvedValueOnce({ id: 123, token_homologacao: TOKEN_HOM });
    const r = await syncEmpresaNaFocus(makeHappySupabase('balu'), COMPANY_ID);
    expect(r.ok).toBe(true);
    const upsert = hAdmin.upsertCalls[0]!;
    expect(upsert.payload).toHaveProperty('token_hom_cifrado');
    expect(upsert.payload).not.toHaveProperty('token_prod_cifrado');
  });

  it('falha ao gravar a credencial (upsert com erro) NÃO marca focus_status=ok, e devolve erro nomeado', async () => {
    h.criarEmpresa.mockResolvedValueOnce({
      id: 123,
      token_homologacao: TOKEN_HOM,
      token_producao: TOKEN_PROD,
    });
    hAdmin.upsertError = { message: 'conexão perdida com o banco' };

    const supabase = makeHappySupabase('balu');
    const r = await syncEmpresaNaFocus(supabase, COMPANY_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/cadastrada na Focus, mas a credencial não pôde ser salva/);
    }

    // A empresa FOI cadastrada na Focus (criarEmpresa foi chamado), mas nenhum
    // update em `companies` pode marcar focus_status='ok' — senão o Diagnóstico
    // mentiria dizendo "cadastrada" para uma empresa sem credencial nenhuma.
    const updsCompanies = supabase.chamadas.filter(
      (c: { tabela: string }) => c.tabela === 'companies',
    ) as ChamadaCompanies[];
    expect(updsCompanies.every((c) => c.payload.focus_status !== 'ok')).toBe(true);
    // E o erro fica registrado (focus_status='erro' + focus_last_error).
    expect(updsCompanies.some((c) => c.payload.focus_status === 'erro')).toBe(true);
  });
});
