// Bloco 5 — a guarda de producao. O teste central do bloco.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `resolverCredencialEmissao`/`tokenParaAmbiente` tem `supabase` opcional com
// default `createAdminClient()` (correcao pos-entrega: os chamadores reais
// usam `createServerClient()`, que nao enxerga `empresa_credenciais_focus` —
// fechada para `authenticated` na 0097). Mockado aqui so para o teste que
// prova que o default existe; os demais testes passam um fake explicito e
// nunca tocam nele.
const hAdmin = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: hAdmin.createAdminClient }));

import {
  decidirCredencial,
  resolverCredencialEmissao,
  tokenParaAmbiente,
  type EstadoFiscal,
} from './resolver-credencial';
import { guardarTokenEmpresa } from './credencial-empresa';

const AMANHA = new Date(Date.now() + 86_400_000).toISOString();
const ONTEM = new Date(Date.now() - 86_400_000).toISOString();

const PRONTA: EstadoFiscal = {
  origem: 'balu',
  ambiente: 'prod',
  tokenHom: 'tok-hom',
  tokenProd: 'tok-prod',
  certNotAfter: AMANHA,
  habilitaProducaoFocus: true,
  producaoDeclarada: false,
};

describe('decidirCredencial', () => {
  it('as quatro verdadeiras → producao', () => {
    expect(decidirCredencial(PRONTA)).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('ambiente hom → homologacao, sem exigir nada de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenProd: null, certNotAfter: null });
    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok-hom' });
  });

  // NUNCA cair em homologacao quando pediram producao (decisao D5).
  it('sem token de producao → ERRO nomeado, nao queda para hom', () => {
    const r = decidirCredencial({ ...PRONTA, tokenProd: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_producao');
  });

  it('certificado vencido → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: ONTEM });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('sem certificado nenhum → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('origem balu sem habilitacao na Focus → erro', () => {
    const r = decidirCredencial({ ...PRONTA, habilitaProducaoFocus: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_habilitada');
  });

  // Para origem propria a habilitacao NAO e verificavel (GET /v2/empresas
  // bloqueado). Vale a DECLARACAO de quem cadastrou.
  it('origem propria aceita a declaracao no lugar do snapshot', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: true,
    });
    expect(r).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('origem propria sem declaracao → erro, motivo proprio (nao confunde com o da balu)', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: false,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_declarada');
  });

  // ESTES DOIS CASOS EXISTEM PARA MATAR UMA MUTACAO ESPECIFICA: trocar o
  // ternario da origem por `declarada || snapshot` passava nos 9 testes
  // anteriores. Sem eles, a regra central do bloco fica sem prova.
  it('balu IGNORA a declaracao — snapshot da Focus e o unico que vale', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'balu', habilitaProducaoFocus: false, producaoDeclarada: true,
    });
    expect(r.ok).toBe(false);
  });

  it('propria IGNORA o snapshot — a declaracao e a unica que vale', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: true, producaoDeclarada: false,
    });
    expect(r.ok).toBe(false);
  });

  it('homologacao sem token de homologacao → erro, nao token de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenHom: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_homologacao');
  });

  it('empresa sem NADA configurado continua em homologacao, como antes da 0096', () => {
    // Os defaults da migration sao exatamente este caso: origem 'balu',
    // ambiente 'hom'. Se este teste quebrar, o deploy muda o comportamento de
    // toda empresa existente.
    const r = decidirCredencial({
      origem: 'balu', ambiente: 'hom', tokenHom: 'tok', tokenProd: null,
      certNotAfter: null, habilitaProducaoFocus: false, producaoDeclarada: false,
    });
    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok' });
  });
});

// ═══ resolverCredencialEmissao / tokenParaAmbiente — a leitura do banco ═══
//
// `guardarTokenEmpresa`/`lerTokenEmpresa` só leem `CERT_ENC_KEY` no MOMENTO da
// chamada (ver `envelope.ts:key()`), não na hora do import — por isso não
// precisa do `vi.resetModules()` que `credencial-empresa.test.ts` usa: basta
// a chave estar setada antes de cada teste chamar cifrar/decifrar.
const CHAVE_ENC_B64 = Buffer.alloc(32, 7).toString('base64');
const ENV_ANTES_LEITURA = { ...process.env };

beforeEach(() => {
  process.env.CERT_ENC_KEY = CHAVE_ENC_B64;
  hAdmin.createAdminClient.mockReset();
});
afterEach(() => { process.env = { ...ENV_ANTES_LEITURA }; });

/**
 * Fake do Supabase que devolve uma linha (ou `null`) por tabela, aceitando
 * `.eq/.is/.order/.limit` em qualquer ordem/quantidade antes do `.maybeSingle`
 * terminal — cobre as duas cadeias reais deste módulo: a de `empresas_fiscais`
 * / `empresa_credenciais_focus` (só `.eq().maybeSingle()`) e a de
 * `arquivos_auxiliares` (`.eq().is().order().limit().maybeSingle()`).
 *
 * `erros` é opcional: por tabela, força `.maybeSingle()` a devolver
 * `{ data: null, error: <valor> }` em vez da linha — usado pelo bloqueio 2
 * (leitura de `empresas_fiscais` falhando, não "linha ausente").
 */
function supabaseFake(tabelas: Record<string, unknown>, erros: Record<string, unknown> = {}) {
  return {
    from: (tabela: string) => {
      const linha = tabelas[tabela] ?? null;
      const erro = erros[tabela] ?? null;
      const chain = {
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: erro ? null : linha, error: erro }),
      };
      return { select: () => chain };
    },
  };
}

describe('resolverCredencialEmissao', () => {
  it('caminho feliz de homologacao: monta o estado do banco e devolve o token decifrado', async () => {
    const tokenHomCifrado = guardarTokenEmpresa('tok-hom-123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({
      empresas_fiscais: {
        focus_origem: 'balu', focus_ambiente: 'hom',
        focus_habilita_nfsen_producao: false, focus_producao_declarada: false,
      },
      empresa_credenciais_focus: { token_hom_cifrado: tokenHomCifrado, token_prod_cifrado: null },
      arquivos_auxiliares: { cert_not_after: null },
    }) as any;

    const r = await resolverCredencialEmissao('empresa-hom', undefined, sb);

    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok-hom-123' });
  });

  // Requisito A (revisao das tasks 3-4): sem linha em `empresas_fiscais`, o
  // `?? 'hom'` tem de decidir homologacao — NUNCA producao. Um mutante que
  // trocasse o fallback por `?? 'prod'` exigiria tokenProd + certificado +
  // habilitacao, nenhum dos quais existe aqui: o resultado deixaria de ser
  // `{ ok: true, ambiente: 'hom' }` e este teste morderia a troca.
  it('empresas_fiscais ausente → decide hom, nunca prod', async () => {
    const tokenHomCifrado = guardarTokenEmpresa('tok-hom-fallback');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({
      empresas_fiscais: null,
      empresa_credenciais_focus: { token_hom_cifrado: tokenHomCifrado, token_prod_cifrado: null },
      arquivos_auxiliares: null,
    }) as any;

    const r = await resolverCredencialEmissao('empresa-sem-config', undefined, sb);

    expect(r.ok).toBe(true);
    expect(r.ok && r.ambiente).toBe('hom');
  });

  // Requisito B (revisao das tasks 3-4): token gravado SEM o prefixo `enc:v1:`
  // e gravacao corrompida (`guardarTokenEmpresa` nunca grava em claro) — nao
  // "token ausente". `sem_token_producao` mentiria dizendo que falta cadastrar
  // algo que ja esta la, so que ilegivel.
  it('token gravado corrompido (sem prefixo enc:v1:) → motivo credencial_corrompida', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({
      empresas_fiscais: {
        focus_origem: 'balu', focus_ambiente: 'hom',
        focus_habilita_nfsen_producao: false, focus_producao_declarada: false,
      },
      empresa_credenciais_focus: { token_hom_cifrado: 'valor-em-claro-sem-prefixo', token_prod_cifrado: null },
      arquivos_auxiliares: null,
    }) as any;

    const r = await resolverCredencialEmissao('empresa-corrompida', undefined, sb);

    expect(r).toEqual({ ok: false, motivo: 'credencial_corrompida' });
  });

  // Bloqueio 2 da revisão final: leitura de `empresas_fiscais` que FALHA (erro,
  // não linha ausente) não pode cair no mesmo `?? 'hom'` do caso "empresa sem
  // configuração" — isso devolveria `ok: true, ambiente: 'hom'` pra uma
  // empresa que pode estar configurada para produção. Tem de ser erro nomeado,
  // sem passar pela guarda.
  it('leitura de empresas_fiscais falhando → ERRO nomeado, nao ok:true com hom', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake(
      {
        empresas_fiscais: null,
        empresa_credenciais_focus: { token_hom_cifrado: null, token_prod_cifrado: null },
        arquivos_auxiliares: null,
      },
      { empresas_fiscais: { message: 'PGRST116: mais de uma linha' } },
    ) as any;

    const r = await resolverCredencialEmissao('empresa-leitura-falha', undefined, sb);

    expect(r).toEqual({ ok: false, motivo: 'estado_fiscal_ilegivel' });
  });

  it('caminho completo de producao: origem balu, tokenProd decifrado, cert futuro, habilitado', async () => {
    const tokenProdCifrado = guardarTokenEmpresa('tok-prod-999');
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({
      empresas_fiscais: {
        focus_origem: 'balu', focus_ambiente: 'prod',
        focus_habilita_nfsen_producao: true, focus_producao_declarada: false,
      },
      empresa_credenciais_focus: { token_hom_cifrado: null, token_prod_cifrado: tokenProdCifrado },
      arquivos_auxiliares: { cert_not_after: amanha },
    }) as any;

    const r = await resolverCredencialEmissao('empresa-prod', undefined, sb);

    expect(r).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod-999' });
  });

  // O parametro `supabase` e opcional com default `createAdminClient()` — o
  // ponto exato que o defeito do plano mordeu: os chamadores reais (actions,
  // route de download) usam `createServerClient()` e nunca passariam client
  // nenhum aqui, entao se o default nao existisse (ou fosse mal escrito) a
  // chamada quebraria com TypeError de `supabase` indefinido, nao com um erro
  // de negocio legivel. Aqui mocka-se `createAdminClient` (via `@/lib/supabase/admin`)
  // para provar que ELE e chamado — sem precisar de `SUPABASE_SERVICE_ROLE_KEY`
  // real no ambiente de teste.
  it('sem client explicito, usa o default (nao lanca TypeError de client indefinido)', async () => {
    hAdmin.createAdminClient.mockReturnValue(supabaseFake({}));

    const r = await resolverCredencialEmissao('empresa-sem-client-explicito');

    expect(hAdmin.createAdminClient).toHaveBeenCalled();
    // Todas as tabelas vazias → hom (ausencia) sem token → recusa nomeada,
    // nunca uma excecao.
    expect(r).toEqual({ ok: false, motivo: 'sem_token_homologacao' });
  });
});

describe('tokenParaAmbiente', () => {
  it('devolve o token cifrado do ambiente pedido, ja decifrado', async () => {
    const tokenProdCifrado = guardarTokenEmpresa('tok-prod-abc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({
      empresa_credenciais_focus: { token_hom_cifrado: null, token_prod_cifrado: tokenProdCifrado },
    }) as any;

    const r = await tokenParaAmbiente('empresa-x', 'prod', sb);

    expect(r).toBe('tok-prod-abc');
  });

  it('sem linha em empresa_credenciais_focus → null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseFake({ empresa_credenciais_focus: null }) as any;

    const r = await tokenParaAmbiente('empresa-y', 'hom', sb);

    expect(r).toBeNull();
  });

  it('sem client explicito, tambem usa o default createAdminClient()', async () => {
    hAdmin.createAdminClient.mockReturnValue(supabaseFake({}));

    const r = await tokenParaAmbiente('empresa-sem-client-explicito', 'hom');

    expect(hAdmin.createAdminClient).toHaveBeenCalled();
    expect(r).toBeNull();
  });
});
