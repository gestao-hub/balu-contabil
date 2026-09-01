import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { ambienteDestrutivo, MOTIVO_SKIP, exigirVitimaSintetica } from './guarda-ambiente';
import {
  criarEmpresario, criarEscritorio, vincularNaCarteira, criarHonorario,
  limparSemeado, SENHA_SINTETICA, type Semeado,
} from './tenant-sintetico';

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
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_ROLE_KEY
 *
 * DOIS ESCRITÓRIOS INTEIROS SÃO SEMEADOS AQUI — o do atacante e o alvo, cada um
 * com contador, cliente na carteira e honorário. Ver `tenant-sintetico.ts`.
 *
 * Antes, o alvo era "o primeiro escritório aprovado do qual este contador não é
 * membro". Isso trocava duas coisas por conveniência. A primeira: contra
 * produção, esse escritório é REAL, e os casos abaixo apagam honorário e emitem
 * cobrança — dano de verdade no dia em que uma defesa cair, que é justamente o
 * dia para o qual o teste existe. A segunda: o `test.skip` por falta de segundo
 * escritório era silencioso, e o banco de produção tem UM escritório — a suíte
 * teria passado sem atacar nada.
 *
 * ─── COMO RODAR ─────────────────────────────────────────────────────────────
 *   export E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 *   npm run build && PORT=3100 npm run start
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test tests/idor-actions-contador.spec.ts
 *
 * Não é hermético: fala com o Supabase e com o servidor de verdade.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// TRAVA DE AMBIENTE: este teste invoca acoes REAIS contra dados REAIS. Desde
// 14/08/2026 o banco da aplicacao e producao e so producao, entao o alvo tem de
// vir de E2E_SUPABASE_URL. Ver tests/guarda-ambiente.ts.
const AMBIENTE = ambienteDestrutivo();
const SB_URL = AMBIENTE?.url ?? '';
const SERVICE = AMBIENTE?.service ?? '';

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
  let admin: ReturnType<typeof createClient>;
  // Preenchido pelos criadores, um id por vez — ver tenant-sintetico.ts.
  const semeado: Semeado = {};

  test.beforeAll(async ({ browser }) => {
    // Skip fica AQUI e não no escopo do describe: `test.skip(cond, motivo)` só
    // vale dentro de um hook ou teste.
    test.skip(!AMBIENTE, MOTIVO_SKIP);
    IDS = idsDoManifest();

    admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

    // ── O ATACANTE: escritório A, com um cliente na carteira ────────────────
    // O cliente próprio não é enfeite: o controle positivo no fim do arquivo
    // confere que a sessão ALCANÇA a própria carteira. Sem ele, "não alcançou o
    // alvo" poderia ser só uma sessão morta.
    const escritorioA = await criarEscritorio(admin, 'idor-ct-atacante', semeado);
    const clienteA = await criarEmpresario(admin, 'idor-ct-cliente-a', semeado);
    await vincularNaCarteira(admin, clienteA.companyId, escritorioA.contabilidadeId);

    // ── A VÍTIMA: escritório B, completo, e alheio ao contador de A ─────────
    const escritorioB = await criarEscritorio(admin, 'idor-ct-vitima', semeado);
    const clienteB = await criarEmpresario(admin, 'idor-ct-cliente-b', semeado);
    await vincularNaCarteira(admin, clienteB.companyId, escritorioB.contabilidadeId);
    const honorarioB = await criarHonorario(admin, {
      contabilidadeId: escritorioB.contabilidadeId,
      companyId: clienteB.companyId,
      empresaClienteId: clienteB.companyId,
    }, semeado);

    alvo = {
      contabilidadeId: escritorioB.contabilidadeId,
      companyId: clienteB.companyId,
      honorarioId: honorarioB,
      nome: escritorioB.nome,
    };
    exigirVitimaSintetica('escritório alvo do IDOR entre contadores', alvo.nome);
    exigirVitimaSintetica('cliente do escritório alvo', clienteB.nomeEmpresa);

    minhaCarteira = clienteA.nomeEmpresa.slice(0, 12);
    const EMAIL = escritorioA.contadorEmail;
    const SENHA = SENHA_SINTETICA;

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

  test.afterAll(async () => {
    await ctx?.dispose();
    if (admin) await limparSemeado(admin, semeado, 'idor-contador');
  });

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
