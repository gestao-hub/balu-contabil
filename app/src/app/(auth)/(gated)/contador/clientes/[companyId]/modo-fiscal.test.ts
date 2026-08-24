// Invariantes de `definirModoFiscalAction` (sessão 32) — o interruptor que
// liga produção fiscal.
//
// POR QUE ESTE ARQUIVO EXISTE
// A 0096 criou `focus_origem`/`focus_ambiente`, a 0098 trancou as duas contra o
// inquilino, e nada no produto as escrevia: produção só era alcançável por
// `UPDATE` manual no banco. Esta action abre esse caminho, e abrir caminho para
// EMISSÃO DE NOTA FISCAL REAL é a coisa mais cara de errar no projeto. Nenhuma
// das garantias abaixo é verificável por `tsc`.
//
// Cada teste morde uma mudança que hoje passa pelo typecheck:
//   1. sumir com o anti-IDOR da carteira (`companyDaCarteira`);
//   2. escrever no companyId DO INPUT em vez do que a carteira provou;
//   3. ligar produção SEM perguntar à guarda — o "não" apareceria semanas
//      depois, na primeira emissão, na frente do cliente;
//   4. tratar erro de leitura como "empresa sem configuração" e gravar assim
//      mesmo (a queda silenciosa que a decisão D5 proíbe);
//   5. trocar a origem de uma empresa já cadastrada na conta Focus da Balu sem
//      confirmação — abandona o cadastro lá e ninguém percebe;
//   6. aceitar valor fora da lista em coluna que tem CHECK no banco;
//   7. gravar sem auditoria, ou sem o de→para que explica a mudança.
//
// A GUARDA NÃO É MOCKADA. `decidirCredencial` e `MENSAGEM_RECUSA` são os de
// verdade; só a LEITURA do banco (`lerEstadoFiscal`) é substituída. Mockar a
// decisão transformaria estes testes em teste do mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstadoFiscal } from '@/lib/fiscal/resolver-credencial';

const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user_contador_1';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'user_dono_1';

type Chamada = {
  tabela: string;
  metodo: 'select' | 'update';
  payload: Record<string, unknown> | null;
  eq: unknown[][];
};

const h = vi.hoisted(() => {
  const chamadas: Chamada[] = [];
  const estado = {
    guard: null as unknown,
    /** null = a empresa NÃO está na carteira deste escritório. */
    alvo: null as unknown,
    /** linha de `empresas_fiscais`; null = não existe. */
    fiscal: null as Record<string, unknown> | null,
    fiscalErro: null as { message: string } | null,
    updateErro: null as { message: string } | null,
    /** quantas linhas o UPDATE afetou (o `.select()` do supabase-js). */
    linhasAfetadas: 1,
    leitura: null as unknown,
  };

  function construir(tabela: string, metodo: 'select' | 'update', payload: Record<string, unknown> | null) {
    const c: Chamada = { tabela, metodo, payload, eq: [] };
    chamadas.push(c);
    const b = {
      eq: (col: unknown, v: unknown) => { c.eq.push([col, v]); return b; },
      is: () => b,
      select: () => b,
      maybeSingle: async () =>
        estado.fiscalErro ? { data: null, error: estado.fiscalErro } : { data: estado.fiscal, error: null },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(
          estado.updateErro
            ? { data: null, error: estado.updateErro }
            : { data: Array.from({ length: estado.linhasAfetadas }, () => ({ empresa_id: COMPANY_ID })), error: null },
        ).then(ok, falhou),
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    select: (cols: string) => construir(tabela, 'select', { cols }),
    update: (payload: Record<string, unknown>) => construir(tabela, 'update', payload),
  }));

  return {
    chamadas,
    estado,
    from,
    // `...args: unknown[]` não é enfeite: sem eles o TS infere aridade zero e
    // `mock.calls[0]` vira `[]` (lição de `cert-actions.test.ts`).
    companyDaCarteira: vi.fn(async (..._args: unknown[]) => estado.alvo),
    registrarAuditoria: vi.fn(async (..._args: unknown[]) => {}),
    revalidatePath: vi.fn(),
    lerEstadoFiscal: vi.fn(async (..._args: unknown[]) => h_leitura()),
  };
});

// Fora do `vi.hoisted` para poder ler `h.estado` sem referência circular.
function h_leitura() {
  return h.estado.leitura;
}

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/contador/carteira', () => ({ companyDaCarteira: h.companyDaCarteira }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/fiscal/credencial-empresa', () => ({
  guardarTokenEmpresa: (v: string) => `enc:v1:${v}`,
  lerTokenEmpresa: (v: string | null) => v,
}));
// SÓ a leitura é substituída — `decidirCredencial` e `MENSAGEM_RECUSA` são os reais.
vi.mock('@/lib/fiscal/resolver-credencial', async (original) => ({
  ...(await original<typeof import('@/lib/fiscal/resolver-credencial')>()),
  lerEstadoFiscal: h.lerEstadoFiscal,
}));

import { definirModoFiscalAction } from './focus-actions';
import { MENSAGEM_RECUSA } from '@/lib/fiscal/resolver-credencial';

const updatesDe = (tabela: string) => h.chamadas.filter((c) => c.tabela === tabela && c.metodo === 'update');

/** Estado que a guarda APROVA para produção: token, certificado vivo e a
 *  habilitação confirmada pela Focus. Cada teste tira uma peça. */
const estadoProdOk = (over: Partial<EstadoFiscal> = {}): EstadoFiscal => ({
  origem: 'balu',
  ambiente: 'hom',
  tokenHom: 'tok-hom',
  tokenProd: 'tok-prod',
  certNotAfter: new Date(Date.now() + 90 * 86400_000).toISOString(),
  habilitaProducaoFocus: true,
  producaoDeclarada: true,
  ...over,
});

const pedido = (over: Record<string, unknown> = {}) => ({
  companyId: COMPANY_ID,
  origem: 'balu' as const,
  ambiente: 'hom' as const,
  ...over,
});

beforeEach(() => {
  h.chamadas.length = 0;
  vi.clearAllMocks();

  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.alvo = { companyId: COMPANY_ID, ownerUserId: OWNER_ID };
  h.estado.fiscal = { focus_origem: 'balu', focus_ambiente: 'hom', focus_empresa_id: null };
  h.estado.fiscalErro = null;
  h.estado.updateErro = null;
  h.estado.linhasAfetadas = 1;
  h.estado.leitura = { ok: true, estado: estadoProdOk() };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('definirModoFiscalAction — fronteira', () => {
  it('recusa escritório não aprovado antes de qualquer leitura ou escrita', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };
    const r = await definirModoFiscalAction(pedido());
    expect(r).toEqual({ ok: false, error: 'Escritório não aprovado.' });
    expect(h.companyDaCarteira).not.toHaveBeenCalled();
    expect(h.chamadas).toHaveLength(0);
  });

  it('recusa empresa fora da carteira SEM ler nem gravar nada', async () => {
    h.estado.alvo = null;
    const r = await definirModoFiscalAction(pedido({ companyId: 'empresa-de-outro-escritorio' }));
    expect(r.ok).toBe(false);
    expect(h.chamadas).toHaveLength(0);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('consulta a carteira com o escritório DO CONTEXTO e a empresa DO PEDIDO', async () => {
    await definirModoFiscalAction(pedido({ ambiente: 'hom' }));
    expect(h.companyDaCarteira).toHaveBeenCalledWith(expect.anything(), CONTABILIDADE_ID, COMPANY_ID);
  });

  it('escreve no companyId PROVADO pela carteira, nunca no do formulário', async () => {
    // Cenário artificial de propósito: a carteira prova UMA empresa e o
    // formulário pede OUTRA. Repassar o do formulário adiante reabriria o
    // buraco que a checagem acabou de fechar.
    h.estado.alvo = { companyId: COMPANY_ID, ownerUserId: OWNER_ID };
    await definirModoFiscalAction(pedido({ companyId: 'id-do-formulario' }));
    for (const c of h.chamadas) {
      for (const [col, valor] of c.eq) {
        if (col === 'empresa_id') expect(valor).toBe(COMPANY_ID);
      }
    }
  });

  it('recusa quando a empresa não tem linha em empresas_fiscais', async () => {
    h.estado.fiscal = null;
    const r = await definirModoFiscalAction(pedido());
    expect(r.ok).toBe(false);
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
  });

  it('FALHA FECHADA: erro de leitura não vira "sem configuração" e não grava', async () => {
    h.estado.fiscalErro = { message: 'conexao caiu' };
    const r = await definirModoFiscalAction(pedido());
    expect(r.ok).toBe(false);
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('recusa quando o UPDATE não alcança linha nenhuma, em vez de dizer que salvou', async () => {
    h.estado.linhasAfetadas = 0;
    const r = await definirModoFiscalAction(pedido());
    expect(r.ok).toBe(false);
  });
});

describe('definirModoFiscalAction — produção só passa pela guarda', () => {
  it('sem token de produção, recusa com o motivo da guarda e NÃO grava', async () => {
    h.estado.leitura = { ok: true, estado: estadoProdOk({ tokenProd: null }) };
    const r = await definirModoFiscalAction(pedido({ ambiente: 'prod' }));
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.sem_token_producao });
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
  });

  it('com certificado vencido, recusa com o motivo da guarda e NÃO grava', async () => {
    h.estado.leitura = {
      ok: true,
      estado: estadoProdOk({ certNotAfter: new Date(Date.now() - 86400_000).toISOString() }),
    };
    const r = await definirModoFiscalAction(pedido({ ambiente: 'prod' }));
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.certificado_invalido });
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
  });

  it('origem balu sem habilitação confirmada pela Focus não vira produção', async () => {
    h.estado.leitura = { ok: true, estado: estadoProdOk({ habilitaProducaoFocus: false }) };
    const r = await definirModoFiscalAction(pedido({ origem: 'balu', ambiente: 'prod' }));
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.producao_nao_habilitada });
  });

  it('origem propria sem a declaração de quem cadastrou não vira produção', async () => {
    // A declaração NÃO é intercambiável com a habilitação conferida: para
    // 'propria' o que vale é a declaração, e ela está faltando aqui.
    h.estado.fiscal = { focus_origem: 'propria', focus_ambiente: 'hom', focus_empresa_id: null };
    h.estado.leitura = {
      ok: true,
      estado: estadoProdOk({ producaoDeclarada: false, habilitaProducaoFocus: true }),
    };
    const r = await definirModoFiscalAction(pedido({ origem: 'propria', ambiente: 'prod' }));
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.producao_nao_declarada });
  });

  it('leitura ilegível do estado fiscal recusa produção com motivo nomeado', async () => {
    h.estado.leitura = { ok: false, motivo: 'estado_fiscal_ilegivel' };
    const r = await definirModoFiscalAction(pedido({ ambiente: 'prod' }));
    expect(r).toEqual({ ok: false, error: MENSAGEM_RECUSA.estado_fiscal_ilegivel });
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
  });

  it('com os quatro critérios em pé, grava prod e audita o de→para', async () => {
    const r = await definirModoFiscalAction(pedido({ ambiente: 'prod' }));
    expect(r).toEqual({ ok: true });
    const [upd] = updatesDe('empresas_fiscais');
    expect(upd!.payload).toMatchObject({ focus_origem: 'balu', focus_ambiente: 'prod' });
    expect(h.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'focus.modo_fiscal_definir',
      alvoId: COMPANY_ID,
      meta: { de: { origem: 'balu', ambiente: 'hom' }, para: { origem: 'balu', ambiente: 'prod' } },
    }));
  });

  it('voltar para homologação não passa pela guarda — a direção segura é sempre aceita', async () => {
    h.estado.fiscal = { focus_origem: 'balu', focus_ambiente: 'prod', focus_empresa_id: null };
    h.estado.leitura = { ok: true, estado: estadoProdOk({ tokenProd: null }) };
    const r = await definirModoFiscalAction(pedido({ ambiente: 'hom' }));
    expect(r).toEqual({ ok: true });
    expect(h.lerEstadoFiscal).not.toHaveBeenCalled();
  });
});

describe('definirModoFiscalAction — trocar a origem', () => {
  it('empresa já cadastrada na conta Focus da Balu exige confirmação para sair de balu', async () => {
    h.estado.fiscal = { focus_origem: 'balu', focus_ambiente: 'hom', focus_empresa_id: 216964 };
    const r = await definirModoFiscalAction(pedido({ origem: 'propria' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cadastrada na conta Focus da Balu/i);
    expect(updatesDe('empresas_fiscais')).toHaveLength(0);
  });

  it('com a confirmação, a troca de origem passa', async () => {
    h.estado.fiscal = { focus_origem: 'balu', focus_ambiente: 'hom', focus_empresa_id: 216964 };
    const r = await definirModoFiscalAction(pedido({ origem: 'propria', ciente_do_cadastro: true }));
    expect(r).toEqual({ ok: true });
    expect(updatesDe('empresas_fiscais')[0]!.payload).toMatchObject({ focus_origem: 'propria' });
  });

  it('empresa sem cadastro na Focus troca de origem sem confirmação', async () => {
    h.estado.fiscal = { focus_origem: 'balu', focus_ambiente: 'hom', focus_empresa_id: null };
    const r = await definirModoFiscalAction(pedido({ origem: 'propria' }));
    expect(r).toEqual({ ok: true });
  });

  it('voltar de propria para balu não pede confirmação nenhuma', async () => {
    h.estado.fiscal = { focus_origem: 'propria', focus_ambiente: 'hom', focus_empresa_id: 216964 };
    const r = await definirModoFiscalAction(pedido({ origem: 'balu' }));
    expect(r).toEqual({ ok: true });
  });
});

describe('definirModoFiscalAction — valores fora da lista', () => {
  it('origem desconhecida cai em balu, ambiente desconhecido cai em hom', async () => {
    // As duas colunas têm CHECK no banco (0096): sem esta normalização, um
    // valor inventado viraria erro de constraint na cara do contador.
    const r = await definirModoFiscalAction(
      pedido({ origem: 'qualquer-coisa', ambiente: 'PROD' } as unknown as { origem: 'balu'; ambiente: 'hom' }),
    );
    expect(r).toEqual({ ok: true });
    expect(updatesDe('empresas_fiscais')[0]!.payload).toMatchObject({
      focus_origem: 'balu',
      focus_ambiente: 'hom',
    });
    // 'PROD' não é 'prod': se tivesse passado, a guarda teria sido consultada.
    expect(h.lerEstadoFiscal).not.toHaveBeenCalled();
  });
});
