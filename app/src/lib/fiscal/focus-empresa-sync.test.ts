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

type CriarEmpresaResp = {
  id: number;
  token_homologacao?: string;
  token_producao?: string;
  // Vêm no GET de uma empresa que JÁ existe na conta — é por eles que o sync
  // decide se ainda precisa do PUT que liga NFS-e.
  habilita_nfse?: boolean;
  habilita_nfsen_homologacao?: boolean;
  habilita_nfsen_producao?: boolean;
};

const h = vi.hoisted(() => ({
  // `...args: unknown[]` pelo mesmo motivo de `atualizarEmpresa`: sem eles o TS
  // infere aridade zero e `mock.calls[0][0]` (o payload do POST) não compila.
  criarEmpresa: vi.fn(async (..._args: unknown[]): Promise<CriarEmpresaResp> => ({ id: 1, token_homologacao: 'tok-hom' })),
  // `...args: unknown[]` não é enfeite: sem eles o TS infere aridade zero e
  // `mock.calls[0][2]` (o ambiente do PUT) nem compila.
  atualizarEmpresa: vi.fn(async (..._args: unknown[]) => ({})),
  consultarEmpresa: vi.fn(async () => ({})),
  // Por default a empresa NÃO existe na Focus — é o caminho de criação, que é
  // o que estes casos medem. Quem testa o VÍNCULO devolve um registro aqui.
  buscarEmpresaPorCnpj: vi.fn(async (): Promise<CriarEmpresaResp | null> => null),
}));

vi.mock('@/lib/clients/focus-nfe', () => ({
  focus: {
    criarEmpresa: h.criarEmpresa,
    atualizarEmpresa: h.atualizarEmpresa,
    consultarEmpresa: h.consultarEmpresa,
    buscarEmpresaPorCnpj: h.buscarEmpresaPorCnpj,
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
/**
 * Stub COMPLETO: `companies` responde de verdade, para o fluxo chegar até o PUT.
 * O de cima (`makeSupabase`) derruba `companies` de propósito e por isso não
 * serve para observar o ambiente que chega na Focus.
 */
function makeSupabaseCompleto(focusAmbiente: string | null) {
  return {
    from: (table: string) => {
      if (table === 'empresas_fiscais') {
        return makeChain({
          data: {
            focus_origem: 'balu',
            focus_ambiente: focusAmbiente,
            // 1 = Simples Nacional no vocabulário da Focus (`regimeCodeToFocus`
            // só aceita 1..4); o stub de cima usa 'anexo3' porque nunca chega
            // a montar payload.
            Code_regime_tributario: '1',
            empresa_fiscal_ativada: true,
            focus_empresa_id: 216964,
            focus_codigo_municipio: '4113700',
          },
          error: null,
        });
      }
      if (table === 'companies') {
        return makeChain({
          data: {
            cnpj: '61061690000183',
            razao_social: 'EMPRESA TESTE LTDA',
            nome: 'Empresa Teste',
            logradouro: 'Rua das Flores',
            numero: '100',
            sem_numero: false,
            bairro: 'Centro',
            municipio: 'Londrina',
            uf: 'PR',
            cep: '86010000',
            codigo_municipio: '4113700',
          },
          error: null,
        });
      }
      return makeChain({ data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('atualizarEmpresaNaFocus — sessão 32: o ambiente sai do banco, não de um literal', () => {
  // POR QUE: os TRÊS chamadores de produto passavam `'hom'` literal. Efeito
  // colateral silencioso: `decidirFlagsNfse` mandava sempre
  // `habilita_nfsen_homologacao`, então NENHUM caminho do produto jamais pedia
  // `habilita_nfsen_producao` à Focus. Uma empresa marcada para produção no
  // Balu seguia, do lado da Focus, habilitada só em homologação — e a emissão
  // real morria lá, depois de a tela daqui já ter dito que estava tudo certo.
  const envDaChamada = () => h.atualizarEmpresa.mock.calls[0]?.[2];
  const payloadDaChamada = () =>
    h.atualizarEmpresa.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

  it("sem env explícito e com focus_ambiente='prod', o PUT vai para produção", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabaseCompleto('prod'), 'empresa-1');
    expect(r.ok).toBe(true);
    expect(envDaChamada()).toBe('prod');
  });

  it("sem env explícito e com focus_ambiente='hom', o PUT segue em homologação", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabaseCompleto('hom'), 'empresa-1');
    expect(r.ok).toBe(true);
    expect(envDaChamada()).toBe('hom');
  });

  it('coluna nula ou com valor inesperado cai em homologação, nunca em produção', async () => {
    await atualizarEmpresaNaFocus(makeSupabaseCompleto(null), 'empresa-1');
    expect(envDaChamada()).toBe('hom');
    h.atualizarEmpresa.mockClear();
    await atualizarEmpresaNaFocus(makeSupabaseCompleto('PRODUCAO'), 'empresa-1');
    expect(envDaChamada()).toBe('hom');
  });

  it('env explícito ainda manda — é o que os scripts de smoke usam', async () => {
    await atualizarEmpresaNaFocus(makeSupabaseCompleto('prod'), 'empresa-1', 'hom');
    expect(envDaChamada()).toBe('hom');
  });

  it("empresa em produção pede `habilita_nfsen_producao` à Focus, e não a flag de homologação", async () => {
    // O município do stub (4113700, Londrina/PR) é o único da lista
    // `ADERENTES_NFSEN_NACIONAL`; é por isso que a flag do payload é a
    // `nfsen_*` e não a `habilita_nfse` legada.
    await atualizarEmpresaNaFocus(makeSupabaseCompleto('prod'), 'empresa-1');
    expect(payloadDaChamada()).toMatchObject({ habilita_nfsen_producao: true });
    expect(payloadDaChamada()).not.toHaveProperty('habilita_nfsen_homologacao');
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// 01/09/2026 — VINCULAR ANTES DE CRIAR, E NASCER COM NFS-e
//
// Os dois defeitos que só apareceram quando o `POST /v2/empresas` voltou a
// funcionar (até 27/08 o token configurado era de EMPRESA, não o principal da
// conta, e a API de Empresas recusava tudo com 401 — nenhum destes caminhos
// chegava a rodar):
//
//   1. A empresa podia JÁ estar na conta da Focus, cadastrada pelo painel. Foi
//      o caso da MCB MARKETING e da AL PISCINAS. Um POST cego ali bate em CNPJ
//      duplicado e trava para sempre uma empresa que estava pronta.
//   2. O POST não mandava flag de NFS-e nenhuma, então toda empresa criada pelo
//      Balu nascia na Focus com NFS-e desligada — e a primeira emissão de
//      serviço falhava, depois de o cadastro já ter dito que deu certo.
// ─────────────────────────────────────────────────────────────────────────────
describe('syncEmpresaNaFocus — vínculo e habilitação de NFS-e', () => {
  const COMPANY_ID = 'empresa-floripa';
  const CNPJ = '53015033000171';
  const FLORIPA = '4205407';

  const COMPANY_ROW = {
    id: COMPANY_ID,
    cnpj: CNPJ,
    razao_social: 'MCB Marketing Ltda',
    nome: 'MCB',
    logradouro: 'Rodovia Armando Calil Bulos',
    numero: '6110',
    sem_numero: false,
    complemento: null,
    bairro: 'Ingleses do Rio Vermelho',
    municipio: 'Florianópolis',
    uf: 'SC',
    cep: '88058001',
    email: null,
    telefone: null,
    inscricao_estadual: null,
    inscricao_municipal: null,
    codigo_municipio: FLORIPA,
  };

  /** Stub que conhece `municipios_nfse` — o provedor decide a flag de NFS-e. */
  function makeSupabase(provedor: string | null = 'Nacional') {
    const chamadas: Array<{ tabela: string; payload: Record<string, unknown> }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      chamadas,
      from: (tabela: string) => {
        if (tabela === 'municipios_nfse') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { provedor_nfse: provedor, nfse_habilitada: provedor != null },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (tabela === 'empresas_fiscais') {
          return {
            select: (cols: string) => ({
              eq: () => ({
                // O `.is('deleted_at', null)` entra no caminho de ATUALIZAÇÃO
                // (o PUT), que lê colunas diferentes das do cadastro — daí os
                // dois ramos responderem coisas distintas para o mesmo select.
                is: () => ({
                  maybeSingle: async () => {
                    if (cols.includes('Code_regime_tributario')) {
                      return {
                        data: {
                          Code_regime_tributario: '1',
                          empresa_fiscal_ativada: true,
                          // Gravado pelo snapshot logo depois do vínculo; sem
                          // ele o PUT desiste com "focus_empresa_id ausente".
                          focus_empresa_id: 246797,
                          focus_codigo_municipio: FLORIPA,
                        },
                        error: null,
                      };
                    }
                    return { data: { focus_origem: 'balu', focus_ambiente: 'hom' }, error: null };
                  },
                }),
                maybeSingle: async () => {
                  if (cols.includes('focus_origem')) return { data: { focus_origem: 'balu' }, error: null };
                  if (cols.includes('Code_regime_tributario')) return { data: { Code_regime_tributario: '1' }, error: null };
                  return { data: null, error: null };
                },
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              chamadas.push({ tabela: 'empresas_fiscais', payload });
              return { eq: async () => ({ data: null, error: null }) };
            },
          };
        }
        if (tabela === 'companies') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { ...COMPANY_ROW }, error: null }) }) }),
            update: (payload: Record<string, unknown>) => {
              chamadas.push({ tabela: 'companies', payload });
              return { eq: async () => ({ data: null, error: null }) };
            },
          };
        }
        throw new Error(`tabela inesperada no teste: ${tabela}`);
      },
    };
    return api;
  }

  beforeEach(() => {
    hAdmin.upsertCalls.length = 0;
    hAdmin.upsertError = null;
    h.criarEmpresa.mockClear();
    h.atualizarEmpresa.mockClear();
    h.buscarEmpresaPorCnpj.mockReset();
    h.buscarEmpresaPorCnpj.mockResolvedValue(null);
  });

  it('município nacional: o POST já pede NFS-e de homologação', async () => {
    h.criarEmpresa.mockResolvedValueOnce({ id: 900, token_homologacao: 'tok-hom', token_producao: 'tok-prod' });
    await syncEmpresaNaFocus(makeSupabase('Nacional'), COMPANY_ID);

    const payload = h.criarEmpresa.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.habilita_nfsen_homologacao).toBe(true);
    // Produção NUNCA no cadastro: emissão real exige certificado A1, que neste
    // instante não existe. Quem promove é `promoverParaProducao`.
    expect(payload.habilita_nfsen_producao).toBeUndefined();
  });

  it('município legado: NENHUMA flag no POST — sem login/senha da prefeitura ela não valeria', async () => {
    h.criarEmpresa.mockResolvedValueOnce({ id: 901, token_homologacao: 'tok-hom' });
    await syncEmpresaNaFocus(makeSupabase('Fiorilli'), COMPANY_ID);

    const payload = h.criarEmpresa.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.habilita_nfse).toBeUndefined();
    expect(payload.habilita_nfsen_homologacao).toBeUndefined();
  });

  it('empresa JÁ na Focus é VINCULADA, não recriada — e os tokens dela são os guardados', async () => {
    h.buscarEmpresaPorCnpj.mockResolvedValue({
      id: 246797,
      token_homologacao: 'tok-da-empresa-hom',
      token_producao: 'tok-da-empresa-prod',
      habilita_nfsen_homologacao: true,
    });

    const r = await syncEmpresaNaFocus(makeSupabase('Nacional'), COMPANY_ID);
    expect(r.ok).toBe(true);
    expect(h.criarEmpresa).not.toHaveBeenCalled();

    const cred = hAdmin.upsertCalls.find((c) => c.tabela === 'empresa_credenciais_focus');
    expect(cred, 'os tokens da empresa existente têm de ser guardados').toBeTruthy();
    expect(lerTokenEmpresa(cred!.payload.token_hom_cifrado as string)).toBe('tok-da-empresa-hom');
    expect(lerTokenEmpresa(cred!.payload.token_prod_cifrado as string)).toBe('tok-da-empresa-prod');
  });

  it('vinculada SEM NFS-e em município nacional → dispara o PUT que liga', async () => {
    // O estado real da MCB MARKETING em 01/09/2026: certificado válido, NFS-e
    // desligada, porque quem a cadastrou foi o painel da Focus e não o Balu.
    h.buscarEmpresaPorCnpj.mockResolvedValue({
      id: 246797,
      token_homologacao: 'tok-hom',
      token_producao: 'tok-prod',
      habilita_nfse: false,
      habilita_nfsen_homologacao: false,
      habilita_nfsen_producao: false,
    });

    await syncEmpresaNaFocus(makeSupabase('Nacional'), COMPANY_ID);
    expect(h.atualizarEmpresa).toHaveBeenCalled();
  });

  it('vinculada que JÁ tem NFS-e ligada não leva PUT à toa', async () => {
    h.buscarEmpresaPorCnpj.mockResolvedValue({
      id: 246797, token_homologacao: 'tok-hom', habilita_nfsen_homologacao: true,
    });
    await syncEmpresaNaFocus(makeSupabase('Nacional'), COMPANY_ID);
    expect(h.atualizarEmpresa).not.toHaveBeenCalled();
  });
});
