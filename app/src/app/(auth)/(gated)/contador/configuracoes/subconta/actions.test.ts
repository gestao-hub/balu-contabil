// Bloco 4B — a rede das invariantes de `criarSubcontaAction`.
//
// POR QUE ESTE ARQUIVO EXISTE
// Os modulos puros do bloco (subconta, subconta-erros, status-subconta,
// credencial-subconta) tem teste. A ACTION, que e onde as consequencias moram,
// nao tinha nenhum — e e nela que vive a unica sequencia do sistema em que
// reordenar duas linhas perde um segredo para sempre: o Asaas devolve a
// `apiKey` da subconta UMA UNICA VEZ, na resposta da criacao.
//
// Cada teste aqui existe para MORDER uma mudanca especifica que hoje passa por
// `tsc --noEmit` e pelo resto da suite:
//   1. mover a auditoria/`revalidatePath` para antes do UPDATE;
//   2. trocar `=== 1` por `>= 0`, ou tirar o `.select('id')` do compare-and-swap;
//   3. deixar o perdedor da corrida (ou a falha de gravacao) sair em silencio;
//   4. mandar a chave — inteira ou mascarada — para log ou auditoria;
//   5. registrar `subconta.possivel_orfa` em 4xx, ou deixar de registrar em 5xx;
//   6. afrouxar a guarda de "ja tem subconta".
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, Asaas, guard, auditoria e `next/cache`.
// Nao ha rede nem banco. A cifra (`credencial-subconta`) e a de VERDADE, com
// uma CERT_ENC_KEY de teste — e o unico jeito de provar que o que vai para a
// coluna esta cifrado e nao em claro.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { guardarCredencial, lerCredencial, mascarar } from '@/lib/billing/credencial-subconta';
import { MENSAGENS_SUBCONTA } from '@/lib/billing/subconta-erros';
import type { AsaasHttpError } from '@/lib/clients/asaas';

// Valor obviamente falso: nenhuma chave real deve existir num fixture.
const CHAVE_FALSA = '$aact_TESTE_chave_obviamente_falsa_nunca_use_1234';
const CONTA_CRIADA = {
  id: 'acc_teste_0001',
  walletId: 'wal_teste_0001',
  apiKey: CHAVE_FALSA,
  name: 'Escritorio Teste LTDA',
  email: 'contato@escritorio-teste.invalid',
  cpfCnpj: '12345678000195',
};

const CONTABILIDADE_ID = 'cont_teste_1';
const USER_ID = 'user_teste_1';

// PJ de proposito: dispensa `birthDate` e mantem o fixture curto.
const DADOS_VALIDOS = {
  name: 'Escritorio Teste LTDA',
  cpfCnpj: '12.345.678/0001-95',
  email: 'contato@escritorio-teste.invalid',
  mobilePhone: '(11) 98888-7777',
  incomeValue: 25000,
  address: 'Rua de Teste',
  addressNumber: '100',
  province: 'Centro',
  postalCode: '01503-000',
  birthDate: null,
  companyType: 'LIMITED' as const,
};

type ChamadaUpdate = {
  tabela: string;
  valores: Record<string, unknown>;
  eq: unknown[][];
  is: unknown[][];
  select: string[];
};

const h = vi.hoisted(() => {
  // Trilha unica de efeitos observaveis, na ordem em que aconteceram. E o que
  // permite afirmar "entre a resposta do Asaas e o UPDATE nao houve NADA".
  const ordem: string[] = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> } & Record<string, unknown>> = [];
  const updates: ChamadaUpdate[] = [];
  const tokensDaSubconta: string[] = [];

  const estado = {
    guard: null as unknown,
    contabilidade: null as Record<string, unknown> | null,
    /** O que o `.select('id')` do UPDATE devolve: 1 linha = venceu a corrida. */
    linhasGravadas: [{ id: 'cont_teste_1' }] as { id: string }[],
    erroUpdate: null as { message: string } | null,
    asaasValor: null as unknown,
    asaasErro: null as unknown,
    statusConta: null as unknown,
    erroStatusConta: null as unknown,
  };

  function construirUpdate(tabela: string, valores: Record<string, unknown>) {
    ordem.push('sb.update');
    const chamada: ChamadaUpdate = { tabela, valores, eq: [], is: [], select: [] };
    updates.push(chamada);
    const resultado = () => {
      // FIEL AO supabase-js: sem `.select()`, `data` (e `count`) voltam null.
      // E o que torna o perdedor da corrida indistinguivel do vencedor — por
      // isso o fake NAO inventa linhas quando o `.select()` nao foi chamado.
      if (chamada.select.length === 0) return { data: null, error: estado.erroUpdate };
      return { data: estado.erroUpdate ? null : estado.linhasGravadas, error: estado.erroUpdate };
    };
    const b = {
      eq: (c: unknown, v: unknown) => { chamada.eq.push([c, v]); return b; },
      is: (c: unknown, v: unknown) => { chamada.is.push([c, v]); return b; },
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
        maybeSingle: async () => ({ data: estado.contabilidade, error: null }),
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => construirUpdate(tabela, valores),
    insert: async () => ({ error: null }),
  }));

  const criarSubconta = vi.fn(async (_payload: Record<string, unknown>) => {
    ordem.push('asaas.criarSubconta');
    if (estado.asaasErro) throw estado.asaasErro;
    return estado.asaasValor;
  });

  const registrarAuditoria = vi.fn(async (e: { acao: string } & Record<string, unknown>) => {
    ordem.push(`audit:${e.acao}`);
    auditorias.push(e);
  });

  const revalidatePath = vi.fn((_p: string) => { ordem.push('revalidatePath'); });

  const asaasSub = vi.fn((token: string) => {
    tokensDaSubconta.push(token);
    return {
      consultarStatusConta: async () => {
        ordem.push('asaas.consultarStatusConta');
        if (estado.erroStatusConta) throw estado.erroStatusConta;
        return estado.statusConta;
      },
    };
  });

  return {
    ordem, auditorias, updates, tokensDaSubconta, estado,
    from, criarSubconta, registrarAuditoria, revalidatePath, asaasSub,
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({
  requireEscritorioAprovado: async () => h.estado.guard,
}));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/clients/asaas', () => ({
  asaasContaMae: { criarSubconta: h.criarSubconta },
  asaasSub: h.asaasSub,
}));

import { criarSubcontaAction, sincronizarStatusSubcontaAction } from './actions';

/** Erro HTTP no formato que `call` (clients/asaas.ts) monta, com `status` anexado. */
function erroHttp(status: number, corpo: string): AsaasHttpError {
  const e = new Error(`Asaas POST /v3/accounts → ${status}: ${corpo}`) as AsaasHttpError;
  e.status = status;
  return e;
}

let logs: string[] = [];

beforeAll(() => {
  // Mesma convencao de credencial-subconta.test.ts: chave fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

beforeEach(() => {
  h.ordem.length = 0;
  h.auditorias.length = 0;
  h.updates.length = 0;
  h.tokensDaSubconta.length = 0;
  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.contabilidade = {
    id: CONTABILIDADE_ID, asaas_subconta_id: null, asaas_subconta_status: 'ausente',
    asaas_api_key_cifrada: null,
  };
  h.estado.linhasGravadas = [{ id: CONTABILIDADE_ID }];
  h.estado.erroUpdate = null;
  h.estado.asaasValor = CONTA_CRIADA;
  h.estado.asaasErro = null;
  h.estado.statusConta = null;
  h.estado.erroStatusConta = null;
  h.criarSubconta.mockClear();
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.asaasSub.mockClear();
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
});

afterEach(() => { vi.restoreAllMocks(); });

/** Tudo que o servidor "falou" sobre esta execucao: log + auditoria + retorno. */
function textoObservado(retorno: unknown): string {
  return JSON.stringify({ logs, auditorias: h.auditorias, retorno });
}

// ---------------------------------------------------------------------------
// 1. ORDEM GRAVAR-PRIMEIRO
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — ordem gravar-primeiro', () => {
  it('o UPDATE e a proxima coisa depois da resposta do Asaas: nada entre os dois', async () => {
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r).toEqual({ ok: true });

    const iAsaas = h.ordem.indexOf('asaas.criarSubconta');
    const iUpdate = h.ordem.indexOf('sb.update');
    expect(iAsaas).toBeGreaterThanOrEqual(0);
    // A `apiKey` so existe entre estes dois indices. Auditoria, revalidate ou
    // qualquer await no meio e uma janela para perder o segredo.
    expect(h.ordem.slice(iAsaas, iUpdate + 1)).toEqual(['asaas.criarSubconta', 'sb.update']);
  });

  it('auditoria de sucesso e revalidatePath so acontecem DEPOIS da gravacao', async () => {
    await criarSubcontaAction(DADOS_VALIDOS);
    const iUpdate = h.ordem.indexOf('sb.update');
    expect(h.ordem.indexOf('audit:subconta.criada')).toBeGreaterThan(iUpdate);
    expect(h.ordem.indexOf('revalidatePath')).toBeGreaterThan(iUpdate);
    expect(h.revalidatePath).toHaveBeenCalledWith('/contador/configuracoes/subconta');
  });

  it('grava id, walletId e a chave CIFRADA na mesma escrita', async () => {
    await criarSubcontaAction(DADOS_VALIDOS);
    const [u] = h.updates;
    expect(u.valores.asaas_subconta_id).toBe(CONTA_CRIADA.id);
    expect(u.valores.asaas_wallet_id).toBe(CONTA_CRIADA.walletId);
    expect(u.valores.asaas_subconta_status).toBe('pendente');

    const cifrada = u.valores.asaas_api_key_cifrada as string;
    expect(cifrada.startsWith('enc:v1:')).toBe(true);
    expect(cifrada).not.toContain(CHAVE_FALSA);
    // Cifra que nao volta e chave perdida do mesmo jeito.
    expect(lerCredencial(cifrada)).toBe(CHAVE_FALSA);
  });
});

// ---------------------------------------------------------------------------
// 2. COMPARE-AND-SWAP DA CORRIDA DE DUPLO CLIQUE
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — compare-and-swap', () => {
  it('o UPDATE e condicional: .eq(id) + .is(asaas_subconta_id, null) + .select(id)', async () => {
    await criarSubcontaAction(DADOS_VALIDOS);
    const [u] = h.updates;
    expect(u.eq).toContainEqual(['id', CONTABILIDADE_ID]);
    // Sem o `.is`, dois cliques simultaneos gravam os dois e o segundo
    // sobrescreve a chave do primeiro.
    expect(u.is).toContainEqual(['asaas_subconta_id', null]);
    // Sem o `.select`, o supabase-js devolve data/count null e o perdedor da
    // corrida vira indistinguivel do vencedor. (O fake honra isso: tirar o
    // `.select` da action faz o teste de sucesso acima falhar tambem.)
    expect(u.select).toContain('id');
  });

  it('perdedor da corrida (0 linhas gravadas) NAO retorna sucesso', async () => {
    h.estado.linhasGravadas = [];
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ terminal: true });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it('vencedor da corrida (exatamente 1 linha) retorna sucesso', async () => {
    h.estado.linhasGravadas = [{ id: CONTABILIDADE_ID }];
    expect(await criarSubcontaAction(DADOS_VALIDOS)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 3. OS DOIS CAMINHOS DE PERDA CONVERGEM PARA AUDITORIA
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — subconta orfa', () => {
  const orfas = () => h.auditorias.filter((a) => a.acao === 'subconta.orfa');

  it('falha de gravacao vira audit_log com account_id, wallet_id e causa "gravacao"', async () => {
    h.estado.erroUpdate = { message: 'permission denied for table contabilidades' };
    const r = await criarSubcontaAction(DADOS_VALIDOS);

    expect(orfas()).toHaveLength(1);
    expect(orfas()[0].meta).toMatchObject({
      asaas_account_id: CONTA_CRIADA.id,
      wallet_id: CONTA_CRIADA.walletId,
      causa: 'gravacao',
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ terminal: true });
  });

  it('cifra que lanca (CERT_ENC_KEY ausente) cai no MESMO caminho de orfa', async () => {
    const antes = process.env.CERT_ENC_KEY;
    delete process.env.CERT_ENC_KEY;
    try {
      const r = await criarSubcontaAction(DADOS_VALIDOS);
      expect(orfas()).toHaveLength(1);
      expect(orfas()[0].meta).toMatchObject({ asaas_account_id: CONTA_CRIADA.id, causa: 'gravacao' });
      expect(r).toMatchObject({ ok: false, terminal: true });
    } finally {
      process.env.CERT_ENC_KEY = antes;
    }
  });

  it('corrida perdida vira audit_log com causa "corrida" — distinguivel da falha de gravacao', async () => {
    h.estado.linhasGravadas = [];
    await criarSubcontaAction(DADOS_VALIDOS);
    expect(orfas()).toHaveLength(1);
    expect(orfas()[0].meta).toMatchObject({
      asaas_account_id: CONTA_CRIADA.id,
      wallet_id: CONTA_CRIADA.walletId,
      causa: 'corrida',
    });
  });

  it('a auditoria de orfa carrega o escopo do escritorio (quem, onde)', async () => {
    h.estado.linhasGravadas = [];
    await criarSubcontaAction(DADOS_VALIDOS);
    expect(orfas()[0]).toMatchObject({
      actorUserId: USER_ID, alvoId: CONTABILIDADE_ID, contabilidadeId: CONTABILIDADE_ID,
    });
  });

  it('nenhum caminho de orfa marca a subconta como criada nem revalida a pagina', async () => {
    h.estado.erroUpdate = { message: 'boom' };
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r.ok).toBe(false);
    expect(h.revalidatePath).not.toHaveBeenCalled();
    expect(h.auditorias.some((a) => a.acao === 'subconta.criada')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. A CHAVE NUNCA ENTRA EM LOG NEM EM AUDITORIA
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — a apiKey nao vaza', () => {
  it('no sucesso, a auditoria leva a chave MASCARADA e nunca a inteira', async () => {
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    const criada = h.auditorias.find((a) => a.acao === 'subconta.criada');
    expect(criada?.meta).toMatchObject({
      asaas_account_id: CONTA_CRIADA.id,
      wallet_id: CONTA_CRIADA.walletId,
      chave: mascarar(CHAVE_FALSA),
    });
    expect(criada?.meta?.chave).not.toBe(CHAVE_FALSA);
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
  });

  it('no caminho de orfa a chave nao aparece — nem mascarada', async () => {
    h.estado.erroUpdate = { message: 'boom' };
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    const t = textoObservado(r);
    expect(t).not.toContain(CHAVE_FALSA);
    // Nem a mascara: no caminho de orfa nao ha motivo nenhum para mencionar a
    // chave, e mascara em log e o primeiro passo para chave em log.
    expect(t).not.toContain(mascarar(CHAVE_FALSA));
    // O que PRECISA estar la para recuperacao manual e o id da conta.
    expect(logs.join(' ')).toContain(CONTA_CRIADA.id);
  });

  it('na corrida perdida a chave tambem nao aparece', async () => {
    h.estado.linhasGravadas = [];
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    const t = textoObservado(r);
    expect(t).not.toContain(CHAVE_FALSA);
    expect(t).not.toContain(mascarar(CHAVE_FALSA));
  });
});

// ---------------------------------------------------------------------------
// 5. subconta.possivel_orfa — "nao sei se nasceu" vs "comprovadamente nao nasceu"
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — possivel orfa', () => {
  const possiveis = () => h.auditorias.filter((a) => a.acao === 'subconta.possivel_orfa');

  it('5xx registra possivel_orfa com o documento (a chave de busca no painel)', async () => {
    h.estado.asaasErro = erroHttp(502, 'Bad Gateway');
    const r = await criarSubcontaAction(DADOS_VALIDOS);

    expect(possiveis()).toHaveLength(1);
    expect(possiveis()[0].meta).toMatchObject({ cpf_cnpj: '12345678000195', status_http: 502 });
    expect(r).toMatchObject({ ok: false, terminal: true });
  });

  it('erro de rede (sem status) tambem registra possivel_orfa', async () => {
    h.estado.asaasErro = new TypeError('fetch failed');
    const r = await criarSubcontaAction(DADOS_VALIDOS);

    expect(possiveis()).toHaveLength(1);
    expect(possiveis()[0].meta).toMatchObject({ cpf_cnpj: '12345678000195', status_http: null });
    expect(r).toMatchObject({ ok: false, terminal: true });
  });

  it('corpo ilegivel (SyntaxError) registra possivel_orfa e nao ecoa o corpo no log', async () => {
    // `res.json()` estourando sobre uma resposta 200 e o unico corpo do sistema
    // que carrega a apiKey — a mensagem do V8 embute um pedaco dele.
    h.estado.asaasErro = new SyntaxError(`Unexpected token in JSON: {"apiKey":"${CHAVE_FALSA}"`);
    const r = await criarSubcontaAction(DADOS_VALIDOS);

    expect(possiveis()).toHaveLength(1);
    expect(textoObservado(r)).not.toContain(CHAVE_FALSA);
  });

  it('4xx NAO registra possivel_orfa: o Asaas recusou e nada nasceu', async () => {
    h.estado.asaasErro = erroHttp(400, '{"errors":[{"code":"invalid_cpfCnpj"}]}');
    const r = await criarSubcontaAction(DADOS_VALIDOS);

    expect(h.registrarAuditoria).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    // Sem `terminal`: corrigir o dado e tentar de novo e o caminho certo.
    expect((r as { terminal?: boolean }).terminal).toBeFalsy();
  });

  it('4xx devolve mensagem propria, nunca o corpo cru do Asaas', async () => {
    h.estado.asaasErro = erroHttp(400, `{"description":"invalid email ${DADOS_VALIDOS.email}"}`);
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    const erro = (r as { error: string }).error;
    expect(MENSAGENS_SUBCONTA as readonly string[]).toContain(erro);
    expect(erro).not.toContain(DADOS_VALIDOS.email);
  });

  it('falha na criacao nunca grava nada na contabilidade', async () => {
    h.estado.asaasErro = erroHttp(400, 'nope');
    await criarSubcontaAction(DADOS_VALIDOS);
    expect(h.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. GUARDAS DE ENTRADA
// ---------------------------------------------------------------------------
describe('criarSubcontaAction — guardas', () => {
  it('escritorio que ja tem subconta nao gasta uma criacao no Asaas', async () => {
    h.estado.contabilidade = {
      id: CONTABILIDADE_ID, asaas_subconta_id: 'acc_ja_existente', asaas_subconta_status: 'pendente',
    };
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r.ok).toBe(false);
    expect(h.criarSubconta).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it('sessao/escritorio nao aprovado nem chega ao Asaas', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r).toEqual({ ok: false, error: 'Escritório não aprovado.' });
    expect(h.criarSubconta).not.toHaveBeenCalled();
  });

  it('escritorio inexistente nao chega ao Asaas', async () => {
    h.estado.contabilidade = null;
    const r = await criarSubcontaAction(DADOS_VALIDOS);
    expect(r.ok).toBe(false);
    expect(h.criarSubconta).not.toHaveBeenCalled();
  });

  it('entrada fora do schema nao chega ao Asaas (KYC e irreversivel)', async () => {
    const r = await criarSubcontaAction({ ...DADOS_VALIDOS, incomeValue: '25000' });
    expect(r.ok).toBe(false);
    expect(h.criarSubconta).not.toHaveBeenCalled();
  });

  it('CPF sem data de nascimento para antes do Asaas', async () => {
    const r = await criarSubcontaAction({
      ...DADOS_VALIDOS, cpfCnpj: '390.533.447-05', companyType: null, birthDate: null,
    });
    expect(r.ok).toBe(false);
    expect(h.criarSubconta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sincronizarStatusSubcontaAction — a chave decifrada e de uso unico
// ---------------------------------------------------------------------------
describe('sincronizarStatusSubcontaAction', () => {
  beforeEach(() => {
    h.estado.contabilidade = {
      id: CONTABILIDADE_ID,
      asaas_subconta_id: CONTA_CRIADA.id,
      asaas_subconta_status: 'pendente',
      asaas_api_key_cifrada: guardarCredencial(CHAVE_FALSA),
    };
    h.estado.statusConta = {
      commercialInfo: 'APPROVED', bankAccountInfo: 'APPROVED',
      documentation: 'APPROVED', general: 'APPROVED',
    };
  });

  it('consulta o KYC com a chave DA SUBCONTA e grava o status novo', async () => {
    const r = await sincronizarStatusSubcontaAction();
    expect(r).toEqual({ ok: true });
    // Com o token da conta-mae isto leria o KYC da Balu — sempre aprovado.
    expect(h.tokensDaSubconta).toEqual([CHAVE_FALSA]);
    expect(h.updates[0].valores.asaas_subconta_status).toBe('aprovada');
  });

  it('a auditoria de mudanca de status nao carrega a chave, nem mascarada', async () => {
    const r = await sincronizarStatusSubcontaAction();
    const t = textoObservado(r);
    expect(t).not.toContain(CHAVE_FALSA);
    expect(t).not.toContain(mascarar(CHAVE_FALSA));
    expect(h.auditorias.find((a) => a.acao === 'subconta.status')?.meta)
      .toMatchObject({ de: 'pendente', para: 'aprovada' });
  });

  it('credencial gravada em claro nao e usada: recusa e manda para o suporte', async () => {
    h.estado.contabilidade = {
      ...h.estado.contabilidade, asaas_api_key_cifrada: '$aact_gravado_em_claro_por_engano',
    };
    const r = await sincronizarStatusSubcontaAction();
    expect(r.ok).toBe(false);
    expect(h.asaasSub).not.toHaveBeenCalled();
    expect(textoObservado(r)).not.toContain('$aact_gravado_em_claro_por_engano');
  });
});
