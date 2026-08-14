import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { ambienteDestrutivo, MOTIVO_SKIP } from './guarda-ambiente';

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
 *   E2E_EMPRESARIO_EMAIL / E2E_EMPRESARIO_SENHA
 *   E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY / E2E_SUPABASE_SERVICE_ROLE_KEY
 *
 * ⚠️ O banco tem de ser de DESENVOLVIMENTO — ver `guarda-ambiente.ts`.
 *
 * Os ALVOS são descobertos em tempo de execução (guia, nota, notificação e
 * cliente de OUTRO dono). Cada caso se declara skipped se não houver alvo —
 * nunca passa vazio.
 *
 * ─── COMO RODAR ─────────────────────────────────────────────────────────────
 *   export E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 *   export E2E_EMPRESARIO_EMAIL=... E2E_EMPRESARIO_SENHA=...
 *   npm run build && PORT=3100 npm run start
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test tests/idor-actions-empresario.spec.ts
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.E2E_EMPRESARIO_EMAIL ?? '';
const SENHA = process.env.E2E_EMPRESARIO_SENHA ?? '';
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
  guiaAlheia?: string;
  notaAlheia?: string;
  notificacaoAlheia?: string;
  clienteAlheio?: string;
  minhaEmpresa: string;
};

test.describe('IDOR entre empresários — Server Actions', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof pwRequest.newContext>>;
  let IDS: Record<string, Acao>;
  let alvos: Alvos;

  test.beforeAll(async ({ browser }) => {
    test.skip(
      !AMBIENTE || !EMAIL || !SENHA,
      !AMBIENTE ? MOTIVO_SKIP : 'faltam E2E_EMPRESARIO_EMAIL / E2E_EMPRESARIO_SENHA',
    );
    IDS = idsDoManifest();

    const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
    const { data: users } = await admin.auth.admin.listUsers();
    const meuId = users.users.find((u) => u.email === EMAIL)?.id;
    expect(meuId, `usuário ${EMAIL} não existe`).toBeTruthy();

    const { data: prof } = await admin.from('profiles')
      .select('current_company').eq('user_id', meuId!).maybeSingle();
    const minhaEmpresa = prof?.current_company as string | undefined;
    expect(minhaEmpresa, `${EMAIL} não tem current_company — o gate de onboarding barraria`).toBeTruthy();

    // Alvos: tudo que pertence a OUTRO dono.
    const { data: outrasEmp } = await admin.from('companies')
      .select('id, user_id').is('deleted_at', null).neq('id', minhaEmpresa!);
    const idsOutras = (outrasEmp ?? []).map((e) => e.id);

    const { data: guia } = await admin.from('guias_fiscais')
      .select('id').in('company_id', idsOutras).is('data_pagamento', null).limit(1).maybeSingle();
    const { data: nota } = await admin.from('notas_fiscais')
      .select('id').in('company_id', idsOutras).neq('status', 'cancelada').limit(1).maybeSingle();
    const { data: notif } = await admin.from('notifications')
      .select('id').neq('owner_user_id', meuId!).limit(1).maybeSingle();
    const { data: cli } = await admin.from('clientes')
      .select('id').neq('owner_user_id', meuId!).is('deleted_at', null).limit(1).maybeSingle();

    alvos = {
      minhaEmpresa: minhaEmpresa!,
      guiaAlheia: guia?.id, notaAlheia: nota?.id,
      notificacaoAlheia: notif?.id, clienteAlheio: cli?.id,
    };

    // Login pela tela — é o fluxo que gera os cookies do @supabase/ssr.
    const page = await browser.newPage({ baseURL: BASE });
    await page.goto('/login');
    await page.getByLabel(/e-?mail/i).fill(EMAIL);
    await page.getByLabel(/senha/i).fill(SENHA);
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

  test.afterAll(async () => { await ctx?.dispose(); });

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
    test.skip(!alvos.guiaAlheia, 'não há guia em aberto de outro dono');
    const r = await chamar('marcarGuiaPagaAction', [alvos.guiaAlheia]);
    expect(devolveuOk(r.corpo), `quitou guia alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('cancelarNotaAction NÃO cancela nota fiscal de outro dono', async () => {
    // O mais grave da lista: nota fiscal é documento com efeito externo.
    // A action lê a nota com `.eq('company_id')` ANTES de falar com a Focus,
    // então a recusa acontece sem nenhuma chamada ao provedor.
    test.skip(!alvos.notaAlheia, 'não há nota de outro dono');
    const r = await chamar('cancelarNotaAction', [alvos.notaAlheia, 'Justificativa de teste automatizado de seguranca']);
    expect(devolveuOk(r.corpo), `cancelou nota alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('marcarNotificacaoLidaAction NÃO marca notificação de outro dono', async () => {
    test.skip(!alvos.notificacaoAlheia, 'não há notificação de outro dono');
    const r = await chamar('marcarNotificacaoLidaAction', [alvos.notificacaoAlheia]);
    expect(devolveuOk(r.corpo), `marcou notificação alheia. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('softDeleteClienteAction NÃO apaga cliente de outro dono', async () => {
    test.skip(!alvos.clienteAlheio, 'não há cliente de outro dono');
    const r = await chamar('softDeleteClienteAction', [alvos.clienteAlheio]);
    expect(devolveuOk(r.corpo), `apagou cliente alheio. corpo=${r.corpo.slice(0, 300)}`).toBe(false);
  });

  test('updateClienteAction NÃO edita cliente de outro dono', async () => {
    test.skip(!alvos.clienteAlheio, 'não há cliente de outro dono');
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
