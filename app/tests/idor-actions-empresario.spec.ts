import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { ambienteDestrutivo, MOTIVO_SKIP, exigirVitimaSintetica } from './guarda-ambiente';
import {
  criarEmpresario, criarCliente, criarGuiaEmAberto, criarNotaAtiva, criarNotificacao,
  limparSemeado, SENHA_SINTETICA, type Empresario, type Semeado,
} from './tenant-sintetico';

/**
 * IDOR entre EMPRESÁRIOS — nas Server Actions.
 *
 * Irmão de `idor-actions-contador.spec.ts`, para o outro lado do produto. O
 * motivo de existir é o mesmo: `rls-*.spec.ts` e `clientes-idor.spec.ts` provam
 * a fronteira do BANCO, e o cabeçalho daquele diz o limite em voz alta ("as
 * actions em si não são chamáveis fora do Next").
 *
 * A diferença em relação ao lado do contador: aqui quase tudo passa por
 * `createServerClient()` (RLS ligada), então a RLS É a defesa. O que este teste
 * acrescenta é provar que as actions HONRAM essa defesa — que nenhuma delas
 * escreve por fora, e que nenhuma devolve sucesso para uma operação que não
 * aconteceu. Foi exatamente esse segundo caso que pegou 5 actions do contador
 * em 14/08/2026: `error` volta null quando o UPDATE não casa nada, e elas
 * gravavam auditoria e diziam ok:true.
 *
 * ─── CONFIGURAÇÃO (nada de segredo aqui — o repo é público) ─────────────────
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_ROLE_KEY
 *
 * Não há mais conta de teste a configurar: ATACANTE E VÍTIMA são semeados aqui
 * (ver `tenant-sintetico.ts`). Antes, o atacante vinha de
 * E2E_EMPRESARIO_EMAIL/SENHA e a vítima era "a primeira linha de outro dono" —
 * o que, contra produção, faria de um cliente real o alvo de operações que
 * cancelam nota fiscal e apagam cliente. Os alvos agora nascem e morrem com o
 * teste, e cada um é conferido por `exigirVitimaSintetica` antes do ataque.
 *
 * Efeito colateral bem-vindo: sumiram os `test.skip('não há guia de outro
 * dono')`. Todo caso tem alvo, sempre.
 *
 * ─── COMO RODAR ─────────────────────────────────────────────────────────────
 *   export E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 *   npm run build && PORT=3100 npm run start
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test tests/idor-actions-empresario.spec.ts
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// TRAVA DE AMBIENTE: este teste invoca acoes REAIS contra dados REAIS. Desde
// 14/08/2026 o banco da aplicacao e producao e so producao, entao o alvo tem de
// vir de E2E_SUPABASE_URL. Ver tests/guarda-ambiente.ts.
const AMBIENTE = ambienteDestrutivo();
const SB_URL = AMBIENTE?.url ?? '';
const SERVICE = AMBIENTE?.service ?? '';

type Acao = { id: string; rota: string };

function idsDoManifest(): Record<string, Acao> {
  const bruto = JSON.parse(
    readFileSync('.next/server/server-reference-manifest.json', 'utf8'),
  ) as { node: Record<string, { workers: Record<string, unknown>; exportedName: string }> };
  const querem = new Set([
    'marcarGuiaPagaAction', 'cancelarNotaAction', 'marcarNotificacaoLidaAction',
    'softDeleteClienteAction', 'updateClienteAction',
  ]);
  const out: Record<string, Acao> = {};
  for (const [id, info] of Object.entries(bruto.node)) {
    if (!querem.has(info.exportedName)) continue;
    out[info.exportedName] = { id, rota: Object.keys(info.workers)[0] };
  }
  return out;
}

function urlDaRota(rota: string): string {
  // Rota com parâmetro dinâmico (`[competencia]`) recebe um valor plausível: o
  // que importa é a action, não o que a página renderiza.
  return rota.replace(/^app/, '').replace(/\/page$/, '')
    .replace(/\/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '202601') || '/';
}

type Alvos = {
  guiaAlheia: string;
  notaAlheia: string;
  notificacaoAlheia: string;
  clienteAlheio: string;
  minhaEmpresa: string;
};

test.describe('IDOR entre empresários — Server Actions', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof pwRequest.newContext>>;
  let IDS: Record<string, Acao>;
  let alvos: Alvos;
  let admin: ReturnType<typeof createClient>;
  // Preenchido pelos criadores, um id por vez — ver tenant-sintetico.ts.
  const semeado: Semeado = {};
  let atacante: Empresario;
  let vitima: Empresario;

  test.beforeAll(async ({ browser }) => {
    test.skip(!AMBIENTE, MOTIVO_SKIP);
    IDS = idsDoManifest();

    admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

    // Os DOIS lados nascem aqui. O atacante é quem loga; a vítima é dona de
    // tudo que ele vai tentar alcançar. Ver o cabeçalho de tenant-sintetico.ts
    // para por que a vítima não pode ser uma linha que já estava no banco.
    atacante = await criarEmpresario(admin, 'idor-emp-atacante', semeado);
    vitima = await criarEmpresario(admin, 'idor-emp-vitima', semeado);

    const clienteAlheio = await criarCliente(admin, vitima, semeado);
    const guiaAlheia = await criarGuiaEmAberto(admin, vitima.companyId, semeado);
    const notaAlheia = await criarNotaAtiva(admin, vitima.companyId, semeado);
    const notificacaoAlheia = await criarNotificacao(admin, vitima.userId, semeado);

    // A conferência que vale: a vítima é sintética, e é ela que vai sofrer o
    // ataque. Lança em vez de pular — chegar aqui com alvo real significa que a
    // semeadura mudou e ninguém viu.
    exigirVitimaSintetica('empresa alvo do IDOR entre empresários', vitima.nomeEmpresa);
    exigirVitimaSintetica('dono dos alvos do IDOR entre empresários', vitima.email);

    alvos = {
      minhaEmpresa: atacante.companyId,
      guiaAlheia, notaAlheia, notificacaoAlheia, clienteAlheio,
    };

    // Login pela tela — é o fluxo que gera os cookies do @supabase/ssr.
    const page = await browser.newPage({ baseURL: BASE });
    await page.goto('/login');
    await page.getByLabel(/e-?mail/i).fill(atacante.email);
    await page.getByLabel(/senha/i).fill(SENHA_SINTETICA);
    await page.getByRole('button', { name: /entrar|login|acessar/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    // Sem passar pelos gates (aceite LGPD, onboarding), todo "bloqueado" abaixo
    // seria só redirect — verde falso.
    await page.goto('/impostos');
    await expect(page).toHaveURL(/\/impostos/, { timeout: 15_000 });

    const cookies = await page.context().cookies();
    ctx = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies, origins: [] } });
    await page.close();
  });

  test.afterAll(async () => {
    await ctx?.dispose();
    if (admin) await limparSemeado(admin, semeado, 'idor-empresario');
  });

  async function chamar(nome: string, args: unknown[]) {
    const acao = IDS[nome];
    expect(acao, `id da action ${nome} não está no manifest — build velho?`).toBeTruthy();
    const r = await ctx.post(urlDaRota(acao.rota), {
      headers: { 'Next-Action': acao.id, 'Content-Type': 'text/plain;charset=UTF-8' },
      data: JSON.stringify(args),
    });
    return { status: r.status(), corpo: await r.text() };
  }

  const devolveuOk = (corpo: string) => /"ok"\s*:\s*true|\\"ok\\":true/.test(corpo);

  test('marcarGuiaPagaAction NÃO quita guia de outro dono', async () => {
    const r = await chamar('marcarGuiaPagaAction', [alvos.guiaAlheia]);
    expect(devolveuOk(r.corpo), `quitou guia alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('cancelarNotaAction NÃO cancela nota fiscal de outro dono', async () => {
    // O mais grave da lista: nota fiscal é documento com efeito externo.
    // A action lê a nota com `.eq('company_id')` ANTES de falar com a Focus,
    // então a recusa acontece sem nenhuma chamada ao provedor.
    const r = await chamar('cancelarNotaAction', [alvos.notaAlheia, 'Justificativa de teste automatizado de seguranca']);
    expect(devolveuOk(r.corpo), `cancelou nota alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('marcarNotificacaoLidaAction NÃO marca notificação de outro dono', async () => {
    const r = await chamar('marcarNotificacaoLidaAction', [alvos.notificacaoAlheia]);
    expect(devolveuOk(r.corpo), `marcou notificação alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('softDeleteClienteAction NÃO apaga cliente de outro dono', async () => {
    const r = await chamar('softDeleteClienteAction', [alvos.clienteAlheio]);
    expect(devolveuOk(r.corpo), `apagou cliente alheio. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('updateClienteAction NÃO edita cliente de outro dono', async () => {
    const r = await chamar('updateClienteAction', [alvos.clienteAlheio, {
      person_type: 'PJ', razao_social: 'INVADIDO', document: '11222333000181', status: 'active',
    }]);
    expect(devolveuOk(r.corpo), `editou cliente alheio. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('CONTROLE POSITIVO: a sessão é real e alcança as próprias telas', async () => {
    // Sem isto, todo "não devolveu ok" acima poderia ser só sessão inválida.
    for (const rota of ['/impostos', '/notas_fiscais', '/notificacoes']) {
      const r = await ctx.get(rota);
      expect(r.status(), `a sessão não alcança ${rota} — os outros casos não provam nada`).toBe(200);
    }
  });
});
