import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// E2E da jornada completa do contador (Task 21, Bloco A): cadastro do escritório →
// aprovação (admin client) → carteira vazia → cadastro de cliente → convite
// dirigido → segundo usuário aceita → co-branding → honorário recorrente pago →
// visão somente-leitura (cliente e contador). Browser-driven (Playwright real,
// contra o BUILD de produção — ver playwright.config.ts), atores descartáveis.
//
// Fallback deliberado (documentar no relatório): os DOIS atores são criados via
// admin.auth.admin.createUser (mesmo idioma de rls-contador.spec.ts) e autenticados
// pela UI REAL de /login — não pelo formulário público de /cadastro. Motivo: o
// signup pela UI dispara o e-mail de confirmação nativo do Supabase (sem
// RESEND_API_KEY/SMTP customizado neste projeto, cai no mailer embutido), que tem
// rate limit agressivo e já observado ("email rate limit exceeded") em execuções
// repetidas da suíte — tornaria o teste irrepetível. A criação de conta em si é
// infraestrutura de auth genérica (já coberta por rls-contador.spec.ts); o que
// importa aqui — ContabilidadeForm, painel do contador, cadastro de cliente,
// convite dirigido, consentimento LGPD no aceite, honorários, co-branding e o
// drill-down somente-leitura — é 100% exercitado pela UI real neste arquivo.
//
// Bate no Supabase real, não hermético. Rodar:
// set -a; . ./.env.local; set +a; npx playwright test walkthrough-contador --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STAMP = Date.now();
const PASS = 'senha-teste-walkthrough-123';

const contadorEmail = `wt-contador-${STAMP}@balu-test.local`;
const clienteEmail = `wt-cliente-${STAMP}@balu-test.local`;
const escritorioNome = `Escritório E2E ${STAMP}`;
const clienteRazaoSocial = `Cliente E2E ${STAMP} LTDA`;

/** Dígito verificador de CNPJ (mesmo algoritmo de src/lib/validators/cnpj.ts). */
function calcDV(digitos: number[]): number {
  let peso = digitos.length - 7;
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) {
    soma += digitos[i] * peso--;
    if (peso < 2) peso = 9;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Gera um CNPJ com dígitos verificadores válidos, determinístico por seed (sem colidir
 *  com "sequência repetida", rejeitada por isValidCnpj). Não precisa existir na Receita —
 *  o pós-processamento (Focus) é best-effort e nunca derruba o cadastro (ver posProcessarNovaEmpresa). */
function gerarCnpjValido(seed: number): string {
  const base: number[] = [];
  let s = seed;
  for (let i = 0; i < 12; i++) {
    s = (s * 1103515245 + 12345) % 100000;
    base.push((s % 9) + 1); // 1..9
  }
  const d1 = calcDV(base);
  const d2 = calcDV([...base, d1]);
  return [...base, d1, d2].join('');
}

const contabilidadeCnpj = gerarCnpjValido(STAMP);
const clienteCnpj = gerarCnpjValido(STAMP + 1);

test.describe('Balu — jornada completa do contador (Bloco A)', () => {
  test.describe.configure({ mode: 'serial' });

  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  let contadorCtx: BrowserContext;
  let contadorPage: Page;
  let clienteCtx: BrowserContext;
  let clientePage: Page;

  let contadorId = '';
  let clienteId = '';
  let contabilidadeId = '';
  let companyId = '';
  let conviteToken = '';
  let honorarioId = '';

  async function loginViaUI(page: Page, email: string, password: string, nextPath?: string) {
    const url = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login';
    await page.goto(url);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForLoadState('networkidle');
  }

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    contadorCtx = await browser.newContext();
    contadorPage = await contadorCtx.newPage();
    clienteCtx = await browser.newContext();
    clientePage = await clienteCtx.newPage();

    // Atores descartáveis (ver nota de fallback no topo do arquivo): criados já
    // confirmados via admin, autenticados na UI real via /login logo em seguida.
    const mk = async (email: string, fullName: string, roleType?: 'Contador') => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PASS, email_confirm: true,
        user_metadata: { full_name: fullName, ...(roleType ? { type: roleType } : {}) },
      });
      expect(error, `createUser ${email} falhou: ${error?.message}`).toBeNull();
      return data.user!.id;
    };
    contadorId = await mk(contadorEmail, 'Contador E2E', 'Contador');
    clienteId = await mk(clienteEmail, 'Cliente E2E');
  });

  test.afterAll(async () => {
    const safe = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { console.warn('[walkthrough-contador][teardown]', e); }
    };
    await safe(() => contadorCtx?.close());
    await safe(() => clienteCtx?.close());

    // Ordem: filhas -> honorarios -> convites -> empresas_fiscais -> companies ->
    // contabilidade_membros -> contabilidades -> profiles -> auth users.
    if (honorarioId) await safe(() => admin.from('honorarios').delete().eq('id', honorarioId));
    if (conviteToken) await safe(() => admin.from('convites').delete().eq('token', conviteToken));
    if (companyId) await safe(() => admin.from('empresas_fiscais').delete().eq('empresa_id', companyId));
    if (companyId) await safe(() => admin.from('companies').delete().eq('id', companyId));
    if (contabilidadeId) await safe(() => admin.from('contabilidade_membros').delete().eq('contabilidade_id', contabilidadeId));
    if (contabilidadeId) await safe(() => admin.from('contabilidades').delete().eq('id', contabilidadeId));
    if (contadorId) await safe(() => admin.from('profiles').delete().eq('user_id', contadorId));
    if (clienteId) await safe(() => admin.from('profiles').delete().eq('user_id', clienteId));
    if (contadorId) await safe(() => admin.auth.admin.deleteUser(contadorId));
    if (clienteId) await safe(() => admin.auth.admin.deleteUser(clienteId));
  });

  test('1. contador entra pela UI e cadastra o escritório (gate de exceção do onboarding)', async () => {
    test.setTimeout(60_000);

    await loginViaUI(contadorPage, contadorEmail, PASS);

    // Gate de exceção do onboarding para o papel Contador (Task 11): a rota
    // renderiza o form direto, sem prender o usuário em /onboarding.
    await contadorPage.goto('/contador/cadastro');
    await expect(contadorPage.getByRole('heading', { name: 'Cadastro do escritório' })).toBeVisible();

    await contadorPage.getByLabel('Nome do escritório').fill(escritorioNome);
    await contadorPage.getByLabel('CNPJ').fill(contabilidadeCnpj);
    await contadorPage.getByLabel('Registro CRC').fill(`CRC-${STAMP}`);
    await contadorPage.getByLabel('UF do CRC').selectOption('SP');
    await contadorPage.getByRole('button', { name: 'Enviar cadastro' }).click();

    await contadorPage.waitForURL('**/contador/aguardando', { timeout: 20_000 });
    await expect(contadorPage.getByRole('heading', { name: 'Cadastro em análise' })).toBeVisible();

    const { data: membro, error } = await admin
      .from('contabilidade_membros').select('contabilidade_id').eq('user_id', contadorId).maybeSingle();
    expect(error, `lookup contabilidade_membros falhou: ${error?.message}`).toBeNull();
    contabilidadeId = (membro?.contabilidade_id as string | undefined) ?? '';
    expect(contabilidadeId, 'contabilidadeId deveria existir após o cadastro do escritório').toBeTruthy();
  });

  test('2. admin aprova a contabilidade (client admin direto)', async () => {
    const { error } = await admin.from('contabilidades').update({ status: 'aprovada' }).eq('id', contabilidadeId);
    expect(error, `aprovar contabilidade falhou: ${error?.message}`).toBeNull();
  });

  test('3. contador recarrega e vê o painel vazio com o estado didático', async () => {
    await contadorPage.goto('/contador');
    await expect(contadorPage.getByRole('heading', { name: 'Painel do escritório' })).toBeVisible();
    await expect(contadorPage.getByText('Sua carteira ainda está vazia.')).toBeVisible();
  });

  test('4. contador cadastra o cliente e envia o convite dirigido', async () => {
    test.setTimeout(60_000);

    await contadorPage.goto('/contador/clientes/novo');
    const form = contadorPage.locator('form');
    // CNPJ sem clicar em "Buscar" — evita depender do sandbox da Focus (best-effort
    // e fora do caminho crítico: posProcessarNovaEmpresa nunca derruba o cadastro).
    await form.getByPlaceholder('00.000.000/0000-00').fill(clienteCnpj);
    await form.getByLabel('Razão social').fill(clienteRazaoSocial);
    await form.getByLabel('Sem número').check();
    await form.getByLabel('Logradouro').fill('Rua Teste E2E');
    await form.getByLabel('Município').fill('São Paulo');
    await form.getByLabel('UF').selectOption('SP');
    // Regime "Normal" (code 3): nem MEI nem Simples — evita que o semáforo classifique
    // amarelo/vermelho por falta de PGDAS-D/DASN em uma empresa recém-criada sem
    // nenhuma declaração (ver src/lib/fiscal/semaforo.ts) — o requisito é 🟢 sem pendências.
    await form.getByLabel('Regime tributário').selectOption('3');
    await form.getByRole('button', { name: 'Criar empresa' }).click();

    await expect(contadorPage.getByRole('heading', { name: 'Convidar o cliente' })).toBeVisible({ timeout: 20_000 });

    const { data: comp, error } = await admin
      .from('companies').select('id').eq('contabilidade_id', contabilidadeId).eq('razao_social', clienteRazaoSocial).maybeSingle();
    expect(error, `lookup da empresa recém-criada falhou: ${error?.message}`).toBeNull();
    companyId = (comp?.id as string | undefined) ?? '';
    expect(companyId, 'companyId deveria existir após o cadastro do cliente').toBeTruthy();

    await contadorPage.getByLabel('E-mail do cliente').fill(clienteEmail);
    await contadorPage.getByRole('button', { name: 'Enviar convite' }).click();

    // Sem RESEND_API_KEY o e-mail é no-op (console.warn) — o link vem do campo
    // copiável da própria UI, não de um e-mail de fato enviado.
    const linkInput = contadorPage.locator('input[readonly]');
    await expect(linkInput).toBeVisible({ timeout: 20_000 });
    const conviteUrl = await linkInput.inputValue();
    expect(conviteUrl, 'URL do convite deveria estar preenchida no campo copiável').toContain('/convite/');
    conviteToken = conviteUrl.split('/convite/')[1] ?? '';
    expect(conviteToken, 'token do convite deveria ter sido extraído da URL').toBeTruthy();

    await contadorPage.getByRole('button', { name: 'Ir para o painel' }).click();
    await contadorPage.waitForURL('**/contador', { timeout: 20_000 });

    const row = contadorPage.locator('tr', { hasText: clienteRazaoSocial });
    await expect(row).toBeVisible();
    await expect(row.getByText('Convite pendente')).toBeVisible();
    // 🟢 sem pendências (regime Normal, zero notas/guias/declarações) → situação "Regular".
    await expect(row.getByText('Regular')).toBeVisible();
  });

  test('5. segundo usuário entra pela UI e aceita o convite dirigido', async () => {
    test.setTimeout(60_000);
    const nextPath = `/convite/${conviteToken}`;

    await loginViaUI(clientePage, clienteEmail, PASS, nextPath);
    if (!clientePage.url().includes(nextPath)) {
      await clientePage.goto(nextPath);
    }

    // Card de aceite com consentimento LGPD (art. 7º/9º) + botão "Aceitar e vincular".
    await expect(clientePage.getByRole('button', { name: 'Aceitar e vincular' })).toBeVisible({ timeout: 20_000 });
    await expect(clientePage.getByText(/somente visualização/i)).toBeVisible();
    await clientePage.getByRole('button', { name: 'Aceitar e vincular' }).click();
    await clientePage.waitForURL((u) => !u.pathname.startsWith('/convite'), { timeout: 20_000 });

    const { data: comp, error } = await admin.from('companies').select('user_id').eq('id', companyId).maybeSingle();
    expect(error, `verificação de posse da empresa falhou: ${error?.message}`).toBeNull();
    expect(comp?.user_id, 'a empresa deveria ter sido assumida pelo cliente que aceitou o convite').toBe(clienteId);
  });

  test('6. cliente vê o co-branding do escritório na sidebar', async () => {
    await clientePage.goto('/');
    await expect(clientePage.getByText(/oferecido por/i)).toBeVisible({ timeout: 20_000 });
    await expect(clientePage.getByText(escritorioNome)).toBeVisible();
  });

  test('7. contador cria honorário recorrente e marca como pago (PIX)', async () => {
    test.setTimeout(60_000);

    await contadorPage.goto('/contador/honorarios');
    await contadorPage.getByRole('button', { name: 'Novo honorário' }).click();

    const form = contadorPage.locator('form');
    await form.getByLabel('Cliente').selectOption({ label: clienteRazaoSocial });
    await form.getByLabel('Competência').fill('2026-08');
    await form.getByLabel('Valor (R$)').fill('350,00');
    await form.getByLabel('Vencimento').fill('2026-08-10');
    await form.getByLabel(/Recorrente/).check();
    await form.getByLabel(/Dia da recorrência/).fill('10');
    await form.getByRole('button', { name: 'Criar' }).click();

    const row = contadorPage.locator('tr', { hasText: clienteRazaoSocial });
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.getByTitle('Marcar como pago').click();
    const confirmDialog = contadorPage.locator('dialog[aria-labelledby="popup-confirm-title"]');
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByLabel('Forma de pagamento').selectOption('pix');
    await confirmDialog.getByRole('button', { name: 'Marcar como pago' }).click();

    await expect(row.getByText('Pago')).toBeVisible({ timeout: 20_000 });

    const { data: hon, error } = await admin
      .from('honorarios').select('id, forma_pagamento')
      .eq('empresa_cliente_id', companyId).eq('contabilidade_id', contabilidadeId).maybeSingle();
    expect(error, `lookup do honorário falhou: ${error?.message}`).toBeNull();
    honorarioId = (hon?.id as string | undefined) ?? '';
    expect(honorarioId, 'honorarioId deveria existir').toBeTruthy();
    expect(hon?.forma_pagamento, 'forma de pagamento deveria ser PIX').toBe('pix');
  });

  test('8. cliente vê o honorário pago em /honorarios, somente leitura', async () => {
    await clientePage.goto('/honorarios');
    await expect(clientePage.getByRole('heading', { name: 'Honorários' })).toBeVisible();
    const row = clientePage.locator('tr', { hasText: 'Pago' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    // Visão do empresário é read-only por construção (HonorariosPage não renderiza
    // HonorarioList) — confere que nenhum botão de ação vazou pra cá.
    await expect(clientePage.getByRole('button', { name: /marcar como pago|editar|excluir/i })).toHaveCount(0);
  });

  test('9. contador acessa o drill-down do cliente em modo leitura, sem botões de ação', async () => {
    await contadorPage.goto(`/contador/clientes/${companyId}`);
    await expect(contadorPage.getByText(/modo leitura/i)).toBeVisible({ timeout: 20_000 });
    await expect(contadorPage.getByRole('button', { name: /emitir|editar|excluir/i })).toHaveCount(0);
  });
});
