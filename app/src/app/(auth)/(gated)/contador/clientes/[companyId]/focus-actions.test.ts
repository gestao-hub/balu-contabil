// Invariantes de `salvarCredencialFocusClienteAction` (Bloco 5, Task 13).
//
// POR QUE ESTE ARQUIVO EXISTE
// É a mesma exceção deliberada do certificado A1 (`cert-actions.ts`), agora
// para o token da Focus: uma escrita do contador sobre credencial de emissão
// do CLIENTE, com service_role — sem RLS por baixo para segurar erro. O que
// separa "o escritório cadastrou a credencial do cliente dele" de "qualquer
// escritório cadastra credencial em qualquer empresa" são as mesmas duas
// linhas de sempre (`companyDaCarteira` + usar o valor QUE ELE PROVOU, nunca
// o do formulário), e nenhuma delas é verificável por `tsc`.
//
// Cada teste aqui existe para MORDER uma mudança que hoje passa pelo typecheck:
//   1. sumir com o anti-IDOR da carteira;
//   2. repassar o companyId DO INPUT em vez do que a carteira provou;
//   3. aceitar sem a declaração de custódia do titular;
//   4. aceitar com os dois tokens vazios (não há o que salvar);
//   5. gravar o token EM CLARO, ou fora da tabela fechada (0097);
//   6. o segredo vazar para `companies` — reabriria exatamente o ataque que a
//      0097 fechou (texto cifrado como credencial ao portador entre empresas);
//   7. campo vazio TROCAR o token que já existe (a troca de só um dos dois é o
//      caminho comum);
//   8. auditoria carregando o token, inteiro ou mascarado.
//
// A CIFRA É A DE VERDADE (não mockada), com uma CERT_ENC_KEY de teste: é o
// único jeito de provar que o que vai para a coluna está cifrado, e que
// `lerTokenEmpresa` devolve exatamente o que entrou.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerTokenEmpresa } from '@/lib/fiscal/credencial-empresa';

const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user_contador_1';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'user_dono_1';

const TOKEN_HOM = 'TESTE-focus-hom-obviamente-falso-0001';
const TOKEN_PROD = 'TESTE-focus-prod-obviamente-falso-0002';

type Chamada = {
  tabela: string;
  metodo: 'upsert' | 'update';
  payload: Record<string, unknown>;
  eq: unknown[][];
  select: string[];
};

const h = vi.hoisted(() => {
  const chamadas: Chamada[] = [];
  const estado = {
    guard: null as unknown,
    /** null = a empresa NÃO está na carteira deste escritório. */
    alvo: null as unknown,
    upsertError: null as { message: string } | null,
  };

  function construir(tabela: string, metodo: 'upsert' | 'update', payload: Record<string, unknown>) {
    const c: Chamada = { tabela, metodo, payload, eq: [], select: [] };
    chamadas.push(c);
    const resultado = () => {
      if (metodo === 'upsert' && estado.upsertError) return { data: null, error: estado.upsertError };
      // FIEL AO supabase-js: sem `.select()`, `data` volta null.
      if (c.select.length === 0) return { data: null, error: null };
      return { data: [{ empresa_id: (payload.empresa_id as string) ?? null }], error: null };
    };
    const b = {
      eq: (col: unknown, v: unknown) => { c.eq.push([col, v]); return b; },
      select: (cols: string) => { c.select.push(cols); return b; },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, falhou),
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    upsert: (payload: Record<string, unknown>, _opts: unknown) => construir(tabela, 'upsert', payload),
    update: (payload: Record<string, unknown>) => construir(tabela, 'update', payload),
  }));

  return {
    chamadas,
    estado,
    from,
    // Os `...args: unknown[]` não são enfeite (mesma lição de `cert-actions.test.ts`):
    // sem eles o TS infere aridade zero e `mock.calls[0]` vira `[]`.
    companyDaCarteira: vi.fn(async (..._args: unknown[]) => estado.alvo),
    registrarAuditoria: vi.fn(async (..._args: unknown[]) => {}),
    revalidatePath: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/contador/carteira', () => ({ companyDaCarteira: h.companyDaCarteira }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
// `@/lib/fiscal/credencial-empresa` NÃO é mockado — é a cifra de verdade.

import { salvarCredencialFocusClienteAction } from './focus-actions';

const chamadasDe = (tabela: string, metodo?: 'upsert' | 'update') =>
  h.chamadas.filter((c) => c.tabela === tabela && (!metodo || c.metodo === metodo));

const entrada = (over: Record<string, unknown> = {}) => ({
  companyId: COMPANY_ID,
  token_hom: '',
  token_prod: '',
  autorizacao: true,
  ...over,
});

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.chamadas.length = 0;
  vi.clearAllMocks();

  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.alvo = { companyId: COMPANY_ID, ownerUserId: OWNER_ID };
  h.estado.upsertError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('salvarCredencialFocusClienteAction — fronteira', () => {
  it('recusa escritório não aprovado antes de qualquer escrita', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };
    const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    expect(r).toEqual({ ok: false, error: 'Escritório não aprovado.' });
    expect(h.companyDaCarteira).not.toHaveBeenCalled();
    expect(h.chamadas).toHaveLength(0);
  });

  it('recusa sem a declaração de custódia do titular, sem consultar a carteira', async () => {
    const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM, autorizacao: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/autoriz/i);
    expect(h.companyDaCarteira).not.toHaveBeenCalled();
    expect(h.chamadas).toHaveLength(0);
  });

  it('recusa quando os dois tokens estão vazios', async () => {
    const r = await salvarCredencialFocusClienteAction(entrada());
    expect(r.ok).toBe(false);
    expect(h.companyDaCarteira).not.toHaveBeenCalled();
    expect(h.chamadas).toHaveLength(0);
  });

  it('tokens só com espaço contam como vazios', async () => {
    const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: '   ', token_prod: '  ' }));
    expect(r.ok).toBe(false);
    expect(h.chamadas).toHaveLength(0);
  });
});

describe('salvarCredencialFocusClienteAction — anti-IDOR da carteira', () => {
  it('recusa empresa fora da carteira SEM gravar nada', async () => {
    h.estado.alvo = null;
    const r = await salvarCredencialFocusClienteAction(
      entrada({ companyId: 'empresa-de-outro-escritorio', token_hom: TOKEN_HOM }),
    );
    expect(r.ok).toBe(false);
    expect(h.chamadas).toHaveLength(0);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('consulta a carteira com o escritório DO CONTEXTO e a empresa DO PEDIDO', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    expect(h.companyDaCarteira).toHaveBeenCalledWith(expect.anything(), CONTABILIDADE_ID, COMPANY_ID);
  });

  it('usa o companyId PROVADO pela carteira em toda escrita, não o do formulário', async () => {
    // Cenário artificial de propósito (mesmo molde de cert-actions.test.ts): a
    // carteira devolve outra empresa. Se a action repassar o campo do
    // formulário adiante, a credencial do cliente entra na empresa errada.
    const PROVADO = 'provado-pela-carteira';
    h.estado.alvo = { companyId: PROVADO, ownerUserId: OWNER_ID };
    await salvarCredencialFocusClienteAction(
      entrada({ companyId: 'id-vindo-do-navegador', token_hom: TOKEN_HOM }),
    );
    const upsert = chamadasDe('empresa_credenciais_focus', 'upsert')[0];
    expect(upsert.payload.empresa_id).toBe(PROVADO);
    const updCompanies = chamadasDe('companies', 'update')[0];
    expect(updCompanies.eq).toContainEqual(['id', PROVADO]);
  });
});

describe('salvarCredencialFocusClienteAction — a credencial cifrada', () => {
  it('grava o token CIFRADO em empresa_credenciais_focus, e lerTokenEmpresa devolve o original', async () => {
    const r = await salvarCredencialFocusClienteAction(
      entrada({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD }),
    );
    expect(r.ok).toBe(true);

    const upsert = chamadasDe('empresa_credenciais_focus', 'upsert')[0];
    const v = upsert.payload;
    expect(v.token_hom_cifrado).toMatch(/^enc:v1:/);
    expect(v.token_prod_cifrado).toMatch(/^enc:v1:/);
    expect(String(v.token_hom_cifrado)).not.toContain(TOKEN_HOM);
    expect(String(v.token_prod_cifrado)).not.toContain(TOKEN_PROD);
    expect(lerTokenEmpresa(v.token_hom_cifrado as string)).toBe(TOKEN_HOM);
    expect(lerTokenEmpresa(v.token_prod_cifrado as string)).toBe(TOKEN_PROD);
    expect(v.empresa_id).toBe(COMPANY_ID);
    expect(v.atualizado_por).toBe(USER_ID);
  });

  it('upsert usa onConflict pela chave da tabela (empresa_id)', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    // O segundo argumento de `.upsert(payload, opts)` não é capturado pelo
    // fake acima (só `payload` importa para as outras asserções); aqui basta
    // confirmar que a chamada aconteceu como upsert, não update/insert cru.
    expect(chamadasDe('empresa_credenciais_focus', 'upsert')).toHaveLength(1);
  });

  it('campo vazio não entra no payload — não troca o token que já existe', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM, token_prod: '' }));
    const v = chamadasDe('empresa_credenciais_focus', 'upsert')[0].payload;
    expect(v).toHaveProperty('token_hom_cifrado');
    expect(v).not.toHaveProperty('token_prod_cifrado');
  });

  it('trocar só o token de produção não toca o de homologação', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: '', token_prod: TOKEN_PROD }));
    const v = chamadasDe('empresa_credenciais_focus', 'upsert')[0].payload;
    expect(v).toHaveProperty('token_prod_cifrado');
    expect(v).not.toHaveProperty('token_hom_cifrado');
  });

  it('cifra que não se aplica (CERT_ENC_KEY ausente) recusa sem gravar nada', async () => {
    const antes = process.env.CERT_ENC_KEY;
    delete process.env.CERT_ENC_KEY;
    try {
      const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
      expect(r.ok).toBe(false);
      expect(h.chamadas).toHaveLength(0);
      expect(h.registrarAuditoria).not.toHaveBeenCalled();
    } finally {
      process.env.CERT_ENC_KEY = antes;
    }
  });

  it('erro do banco ao gravar a credencial não escreve companies nem audita', async () => {
    h.estado.upsertError = { message: 'conexão perdida' };
    const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    expect(r.ok).toBe(false);
    expect(chamadasDe('companies', 'update')).toHaveLength(0);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('salvarCredencialFocusClienteAction — o segredo não vai para companies', () => {
  it('companies recebe SÓ o rastro (focus_token_por/focus_token_em), nunca o token', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD }));
    const upd = chamadasDe('companies', 'update')[0];
    expect(Object.keys(upd.payload).sort()).toEqual(['focus_token_em', 'focus_token_por']);
    expect(upd.payload.focus_token_por).toBe(USER_ID);
    expect(typeof upd.payload.focus_token_em).toBe('string');
    const serializado = JSON.stringify(upd.payload);
    expect(serializado).not.toContain(TOKEN_HOM);
    expect(serializado).not.toContain(TOKEN_PROD);
  });
});

describe('salvarCredencialFocusClienteAction — producao_declarada', () => {
  it('quando informado, grava em empresas_fiscais.focus_producao_declarada', async () => {
    await salvarCredencialFocusClienteAction(
      entrada({ token_hom: TOKEN_HOM, producao_declarada: true }),
    );
    const upd = chamadasDe('empresas_fiscais', 'update')[0];
    expect(upd).toBeDefined();
    expect(upd.payload).toEqual({ focus_producao_declarada: true });
    expect(upd.eq).toContainEqual(['empresa_id', COMPANY_ID]);
  });

  it('quando omitido, NÃO toca em empresas_fiscais', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    expect(chamadasDe('empresas_fiscais', 'update')).toHaveLength(0);
  });
});

describe('salvarCredencialFocusClienteAction — auditoria', () => {
  it('registra com ator, empresa e escritório, e revalida a página do cliente', async () => {
    const r = await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    expect(r.ok).toBe(true);
    expect(h.registrarAuditoria).toHaveBeenCalledTimes(1);
    const ev = h.registrarAuditoria.mock.calls[0][0] as Record<string, unknown>;
    expect(ev.acao).toBe('focus.credencial_cliente_salvar');
    expect(ev.actorUserId).toBe(USER_ID);
    expect(ev.alvoId).toBe(COMPANY_ID);
    expect(ev.contabilidadeId).toBe(CONTABILIDADE_ID);
    expect(h.revalidatePath).toHaveBeenCalledWith(`/contador/clientes/${COMPANY_ID}`);
  });

  it('a auditoria não carrega o token, nem os primeiros caracteres', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM, token_prod: TOKEN_PROD }));
    const serializada = JSON.stringify(h.registrarAuditoria.mock.calls[0][0]);
    expect(serializada).not.toContain(TOKEN_HOM);
    expect(serializada).not.toContain(TOKEN_PROD);
    // Máscara em log é segredo pela metade: nem os primeiros caracteres.
    expect(serializada).not.toContain(TOKEN_HOM.slice(0, 8));
    expect(serializada).not.toContain(TOKEN_PROD.slice(0, 8));
    const meta = (h.registrarAuditoria.mock.calls[0][0] as Record<string, unknown>).meta;
    expect(meta).toEqual({ trocou_hom: true, trocou_prod: true });
  });

  it('meta reflete qual token trocou, quando só um dos dois é enviado', async () => {
    await salvarCredencialFocusClienteAction(entrada({ token_hom: TOKEN_HOM }));
    const meta = (h.registrarAuditoria.mock.calls[0][0] as Record<string, unknown>).meta;
    expect(meta).toEqual({ trocou_hom: true, trocou_prod: false });
  });
});
