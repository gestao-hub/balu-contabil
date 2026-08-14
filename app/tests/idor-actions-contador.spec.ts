import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/**
 * IDOR entre escritórios — nas SERVER ACTIONS, não só na RLS.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 * `clientes-idor.spec.ts` e `rls-contador.spec.ts` cobrem a fronteira do BANCO,
 * e o cabeçalho do primeiro é honesto sobre o limite: "as actions em si não são
 * chamáveis fora do Next — este teste bate direto nas mutações Supabase".
 *
 * Só que as actions do contador usam `createAdminClient()`, que IGNORA RLS. Ali
 * a única defesa é o guard escrito em TypeScript (`companyDaCarteira`,
 * `clienteDaCarteira`, `aberturaDaCarteira`, `.eq('contabilidade_id')`). Provar
 * o banco não prova esses guards — se um deles faltasse, a RLS não estaria lá
 * para segurar.
 *
 * Este teste fecha a lacuna: faz LOGIN DE VERDADE e invoca cada action pela
 * REDE, com o protocolo real de Server Action (POST na rota que a hospeda, com
 * o header `Next-Action` e o id extraído do build), passando ids do OUTRO
 * escritório.
 *
 * ─── O QUE ELE JÁ ACHOU ─────────────────────────────────────────────────────
 * Em 14/08/2026, na primeira execução: cinco actions tratavam "zero linhas
 * afetadas" como sucesso. O `.eq('contabilidade_id')` impedia o dano, mas
 * `error` volta null quando o UPDATE não casa nada — e elas gravavam auditoria
 * e devolviam ok:true. Qualquer contador autenticado carimbava o `audit_log`
 * com o UUID que quisesse. Nenhum teste de RLS pegaria isso.
 *
 * ─── CONFIGURAÇÃO (nada de segredo neste arquivo — o repo é público) ────────
 * Exige, no ambiente:
 *   E2E_CONTADOR_EMAIL   e-mail de um contador de teste, membro de um escritório aprovado
 *   E2E_CONTADOR_SENHA   senha dele
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *
 * O escritório-ALVO e os ids dele são DESCOBERTOS em tempo de execução (o
 * primeiro escritório aprovado do qual este contador não é membro). Sem um
 * segundo escritório na base, o teste se declara skipped em vez de passar
 * vazio — teste que passa por falta de dado é pior que teste nenhum.
 *
 * ─── COMO RODAR ─────────────────────────────────────────────────────────────
 *   set -a; . ./.env.local; set +a
 *   export E2E_CONTADOR_EMAIL=... E2E_CONTADOR_SENHA=...
 *   npm run build && PORT=3100 npm run start
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test tests/idor-actions-contador.spec.ts
 *
 * Não é hermético: fala com o Supabase e com o servidor de verdade.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.E2E_CONTADOR_EMAIL ?? '';
const SENHA = process.env.E2E_CONTADOR_SENHA ?? '';
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Acao = { id: string; rota: string };

/**
 * Os ids das Server Actions saem do manifest do BUILD — eles são hash de
 * (módulo + nome do export), então mudam quando o arquivo é movido/renomeado.
 * Gerar aqui, a partir do build atual, é o que impede o teste de silenciosamente
 * chamar uma action que não existe mais.
 */
function idsDoManifest(): Record<string, Acao> {
  const bruto = JSON.parse(
    readFileSync('.next/server/server-reference-manifest.json', 'utf8'),
  ) as { node: Record<string, { workers: Record<string, unknown>; exportedName: string }> };
  const querem = new Set([
    'cobrarClienteAction', 'registrarDeclaracaoAnualContadorAction',
    'removerClienteDaCarteiraAction', 'marcarPagoV2Action', 'deleteHonorarioV2Action',
    'updateHonorarioV2Action', 'cobrarHonorarioAction',
  ]);
  const out: Record<string, Acao> = {};
  for (const [id, info] of Object.entries(bruto.node)) {
    if (!querem.has(info.exportedName)) continue;
    const rotas = Object.keys(info.workers);
    out[info.exportedName] = { id, rota: rotas.find((r) => r.includes('contador')) ?? rotas[0] };
  }
  return out;
}

/** `app/(auth)/(gated)/contador/x/page` → `/contador/x` */
function urlDaRota(rota: string, subs: Record<string, string> = {}): string {
  let u = rota.replace(/^app/, '').replace(/\/page$/, '').replace(/\/\([^)]+\)/g, '');
  for (const [k, v] of Object.entries(subs)) u = u.replace(`[${k}]`, v);
  return u || '/';
}

test.describe('IDOR entre escritórios — Server Actions do contador', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof pwRequest.newContext>>;
  let IDS: Record<string, Acao>;
  /** O escritório que o contador logado NÃO pode alcançar. */
  let alvo: { contabilidadeId: string; companyId: string; honorarioId: string; nome: string };
  /** Um pedaço do nome do próprio cliente, para o controle positivo. */
  let minhaCarteira: string;

  test.beforeAll(async ({ browser }) => {
    // Skip fica AQUI e não no escopo do describe: `test.skip(cond, motivo)` só
    // vale dentro de um hook ou teste. Sem credencial no ambiente, o arquivo se
    // declara pulado — nunca "passa" por não ter o que fazer.
    test.skip(
      !EMAIL || !SENHA || !SB_URL || !SERVICE,
      'faltam E2E_CONTADOR_EMAIL / E2E_CONTADOR_SENHA / env do Supabase',
    );
    IDS = idsDoManifest();

    const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
    const { data: eu } = await admin.from('contabilidade_membros')
      .select('contabilidade_id, user_id, contabilidades(nome)')
      .limit(200);
    const { data: users } = await admin.auth.admin.listUsers();
    const meuId = users.users.find((u) => u.email === EMAIL)?.id;
    expect(meuId, `usuário ${EMAIL} não existe no Supabase`).toBeTruthy();

    const minha = (eu ?? []).find((m) => m.user_id === meuId)?.contabilidade_id;
    expect(minha, `${EMAIL} não é membro de nenhum escritório`).toBeTruthy();

    // O ALVO: outro escritório aprovado, com cliente e honorário próprios.
    const { data: outros } = await admin.from('contabilidades')
      .select('id, nome').eq('status', 'aprovada').neq('id', minha!);
    let achado: typeof alvo | null = null;
    for (const o of outros ?? []) {
      const { data: emp } = await admin.from('companies')
        .select('id').eq('contabilidade_id', o.id).is('deleted_at', null).limit(1).maybeSingle();
      const { data: hon } = await admin.from('honorarios')
        .select('id').eq('contabilidade_id', o.id).limit(1).maybeSingle();
      if (emp && hon) { achado = { contabilidadeId: o.id, companyId: emp.id, honorarioId: hon.id, nome: o.nome }; break; }
    }
    test.skip(!achado, 'não há um segundo escritório aprovado com cliente e honorário — nada a atacar');
    alvo = achado!;

    const { data: meuCliente } = await admin.from('companies')
      .select('nome').eq('contabilidade_id', minha!).is('deleted_at', null).limit(1).maybeSingle();
    minhaCarteira = (meuCliente?.nome ?? '').slice(0, 12);

    // Login pela TELA, não por atalho: é o fluxo que gera os cookies do
    // @supabase/ssr que as actions vão ler. Atalho aqui inventaria uma sessão
    // que o app não produz, e o teste passaria a provar outra coisa.
    const page = await browser.newPage({ baseURL: BASE });
    await page.goto('/login');
    await page.getByLabel(/e-?mail/i).fill(EMAIL);
    await page.getByLabel(/senha/i).fill(SENHA);
    await page.getByRole('button', { name: /entrar|login|acessar/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    // A sessão precisa chegar em /contador sem esbarrar em aceite/onboarding —
    // senão o "bloqueado" das actions seria só redirect, e o verde seria falso.
    await page.goto('/contador');
    await expect(page).toHaveURL(/\/contador/, { timeout: 15_000 });

    const cookies = await page.context().cookies();
    ctx = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies, origins: [] } });
    await page.close();
  });

  test.afterAll(async () => { await ctx?.dispose(); });

  async function chamar(nome: string, args: unknown[], subs: Record<string, string> = {}) {
    const acao = IDS[nome];
    expect(acao, `id da action ${nome} não está no manifest — o build está velho?`).toBeTruthy();
    const r = await ctx.post(urlDaRota(acao.rota, subs), {
      headers: { 'Next-Action': acao.id, 'Content-Type': 'text/plain;charset=UTF-8' },
      data: JSON.stringify(args),
    });
    return { status: r.status(), corpo: await r.text() };
  }

  /** Devolve o motivo de NÃO ter recusado, ou null se recusou como deve. */
  function porqueNaoRecusou(corpo: string): string | null {
    if (/"ok"\s*:\s*true|\\"ok\\":true/.test(corpo)) return 'a action devolveu ok:true';
    if (alvo.nome && corpo.includes(alvo.nome)) return 'a resposta contém o nome do escritório alvo';
    return null;
  }

  function casos() {
    return [
      { nome: 'cobrarClienteAction', oQue: 'emitir cobrança contra o cliente alheio',
        subs: { companyId: alvo.companyId },
        args: [{ companyId: alvo.companyId, descricaoLivre: 'INVASAO', baseCentavos: 10_000,
          vencimento: '2099-12-31', idempotencyKey: '11111111-1111-4111-8111-111111111111' }] },
      { nome: 'registrarDeclaracaoAnualContadorAction', oQue: 'registrar declaração no cliente alheio',
        subs: { companyId: alvo.companyId },
        args: [{ companyId: alvo.companyId, tipo: 'DASN-SIMEI', competencia: '2025', numeroRecibo: 'INVASAO' }] },
      { nome: 'removerClienteDaCarteiraAction', oQue: 'remover o cliente da carteira alheia',
        args: [alvo.companyId] },
      { nome: 'marcarPagoV2Action', oQue: 'quitar honorário alheio',
        args: [alvo.honorarioId, 'pix'] },
      { nome: 'deleteHonorarioV2Action', oQue: 'apagar honorário alheio',
        args: [alvo.honorarioId] },
      { nome: 'updateHonorarioV2Action', oQue: 'alterar honorário alheio',
        args: [alvo.honorarioId, { valor: '1.00', data_vencimento: '2099-01-01',
          empresa_cliente_id: alvo.companyId, mes_referencia: '2099-01', recorrente: false }] },
      { nome: 'cobrarHonorarioAction', oQue: 'emitir cobrança do honorário alheio',
        args: [alvo.honorarioId] },
    ];
  }

  test('nenhuma action do contador alcança o outro escritório', async () => {
    const vazamentos: string[] = [];
    for (const caso of casos()) {
      const r = await chamar(caso.nome, caso.args, caso.subs);
      const motivo = porqueNaoRecusou(r.corpo);
      if (motivo) vazamentos.push(`${caso.nome} — ${caso.oQue}: ${motivo} (status ${r.status})`);
    }
    expect(vazamentos, `actions que NÃO recusaram:\n${vazamentos.join('\n')}`).toEqual([]);
  });

  test('a página do cliente alheio não renderiza os dados dele', async () => {
    const r = await ctx.get(`/contador/clientes/${alvo.companyId}`);
    const corpo = await r.text();
    expect(
      corpo.includes(alvo.nome),
      `a página /contador/clientes/<alheio> devolveu dados de "${alvo.nome}" (status ${r.status()})`,
    ).toBe(false);
  });

  test('CONTROLE POSITIVO: a sessão é real e alcança a PRÓPRIA carteira', async () => {
    // Sem isto, todo "recusou" acima poderia ser só sessão inválida — o teste
    // passaria sem testar nada.
    const r = await ctx.get('/contador');
    expect(r.status(), 'a sessão não chega em /contador — os outros casos não provam nada').toBe(200);
    const corpo = await r.text();
    expect(
      minhaCarteira.length === 0 || corpo.includes(minhaCarteira),
      'a carteira do próprio escritório não apareceu — a sessão pode não estar autenticada',
    ).toBe(true);
  });
});
