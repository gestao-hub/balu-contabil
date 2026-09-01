import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { ambienteDestrutivo, MOTIVO_SKIP, exigirVitimaSintetica } from './guarda-ambiente';
import {
  criarEmpresario, criarEscritorio, vincularNaCarteira,
  limparSemeado, SENHA_SINTETICA, type Semeado,
} from './tenant-sintetico';

/**
 * AS ACTIONS DO TITULAR, ALCANÇADAS PELO CONTADOR.
 *
 * ─── O QUE ESTE ARQUIVO PROVA, E POR QUE ELE PRECISOU EXISTIR ───────────────
 * `idor-actions-contador.spec.ts` cobre as actions DO CONTADOR contra outro
 * escritório. Este cobre o outro lado, que ninguém tinha medido: as actions do
 * TITULAR, chamadas por um contador cuja `current_company` aponta para uma
 * empresa da própria carteira.
 *
 * Esse apontamento é LEGÍTIMO e deliberado. A migration 0100 valida
 * `current_company` e aceita dois casos: empresa que o usuário possui, ou
 * empresa da carteira do escritório dele. O cabeçalho dela diz, por escrito,
 * quem faz a separação a partir daí:
 *
 *   "Quem separa 'vê a empresa' de 'opera documento fiscal dela' é
 *    `empresaDoDono`, na aplicação, e continua sendo."
 *
 * O banco delegou. `notas_fiscais/actions.ts` recebeu a guarda em 14 pontos;
 * `impostos/actions.ts` e `configuracoes/actions.ts` nunca receberam nenhuma —
 * 12 actions lendo `current_company` como se fosse prova de posse, que é o que
 * ela deixou de ser em 24/08/2026.
 *
 * O caso mais grave da lista não é fiscal, é destrutivo: `uploadCertificadoAction`
 * entrega `companyId` a `processarUploadCertificado`, e o upload usa o client de
 * SERVICE ROLE com `upsert: true` em `${companyId}/certificado.enc` — a chave
 * privada A1 cifrada do cliente, sobrescrita por cima da RLS.
 *
 * O contador TEM caminho legítimo para subir certificado de cliente
 * (`contador/clientes/[companyId]/cert-actions.ts`, migration 0085): com prova
 * de carteira, declaração de autorização do titular e trilha de auditoria em
 * `cert_enviado_por`. Pela porta do titular não há nenhuma das três.
 *
 * ─── COMO RODAR ─────────────────────────────────────────────────────────────
 *   export E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 *   npm run build && npm run start
 *   npx playwright test tests/idor-actions-titular.spec.ts
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const AMBIENTE = ambienteDestrutivo();
const SB_URL = AMBIENTE?.url ?? '';
const ANON = AMBIENTE?.anon ?? '';
const SERVICE = AMBIENTE?.service ?? '';

/** A recusa esperada — a string de `lib/auth/empresa-dono.ts`. */
const MENSAGEM_NAO_E_DONO =
  'Esta operação é do titular da empresa. O acesso do escritório contábil é somente visualização.';

type Acao = { id: string; rota: string };

function idsDoManifest(nomes: string[]): Record<string, Acao> {
  const bruto = JSON.parse(
    readFileSync('.next/server/server-reference-manifest.json', 'utf8'),
  ) as { node: Record<string, { workers: Record<string, unknown>; exportedName: string }> };
  const querem = new Set(nomes);
  const out: Record<string, Acao> = {};
  for (const [id, info] of Object.entries(bruto.node)) {
    if (!querem.has(info.exportedName)) continue;
    out[info.exportedName] = { id, rota: Object.keys(info.workers)[0] };
  }
  return out;
}

function urlDaRota(rota: string): string {
  return rota.replace(/^app/, '').replace(/\/page$/, '')
    .replace(/\/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '202601') || '/';
}

const CASOS: Array<{ nome: string; args: unknown[]; oQue: string }> = [
  // ⚠️ `YYYYMM`, não `YYYY-MM`. Estas actions validam o formato ANTES da guarda,
  // e com a string errada respondem "Competência inválida" — uma recusa que não
  // diz nada sobre posse. A primeira versão deste arquivo errou os três
  // argumentos abaixo e acusou o produto por isso; foi a asserção na mensagem
  // EXATA que denunciou o teste em vez de deixar passar um falso vermelho.
  { nome: 'gerarDasSimplesAction', args: ['202601'], oQue: 'gerar DAS do Simples do cliente na Receita' },
  { nome: 'gerarDasMeiAction', args: ['202601'], oQue: 'gerar DAS do MEI do cliente na Receita' },
  { nome: 'consultarDeclaracoesAction', args: [2026], oQue: 'consultar declarações do cliente' },
  { nome: 'consultarDasnSimeiAction', args: [2026], oQue: 'consultar DASN-SIMEI do cliente' },
  { nome: 'previewDeclaracaoAction', args: ['202601'], oQue: 'gerar prévia de declaração do cliente' },
  { nome: 'iniciarApuracaoAction', args: ['202601', 'commit'], oQue: 'apurar imposto do cliente' },
  { nome: 'marcarGuiaPagaAction', args: ['00000000-0000-4000-8000-000000000000'], oQue: 'quitar guia do cliente' },
  { nome: 'salvarFolhaAction', args: [[{ competencia: '202601', proLabore: 0, salarios: 0, encargos: 0 }]], oQue: 'gravar folha do cliente (base do Fator R)' },
  { nome: 'marcarSincronizacaoInicialAction', args: [], oQue: 'carimbar sincronização do cliente' },
  { nome: 'upsertEmpresaFiscalAction', args: [{}], oQue: 'alterar configuração fiscal do cliente' },
  { nome: 'syncFocusEmpresaAction', args: [], oQue: 'reescrever o cadastro do cliente na Focus' },
];

test.describe('IDOR: as actions do titular não operam a empresa do cliente', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof pwRequest.newContext>>;
  let IDS: Record<string, Acao>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any;
  const semeado: Semeado = {};

  test.beforeAll(async ({ browser }) => {
    test.skip(!AMBIENTE, MOTIVO_SKIP);
    IDS = idsDoManifest(CASOS.map((c) => c.nome));

    admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

    const escritorio = await criarEscritorio(admin, 'idor-tit-escritorio', semeado);
    const cliente = await criarEmpresario(admin, 'idor-tit-cliente', semeado);
    await vincularNaCarteira(admin, cliente.companyId, escritorio.contabilidadeId);
    exigirVitimaSintetica('empresa cliente do IDOR de actions do titular', cliente.nomeEmpresa);

    // ── A PREMISSA, PROVADA E NÃO SUPOSTA ─────────────────────────────────
    // O contador aponta `current_company` para a empresa do CLIENTE usando a
    // PRÓPRIA SESSÃO (anon key), não o service role. Se o trigger
    // `tg_profiles_trava_colunas` recusasse, a análise inteira deste arquivo
    // estaria errada e o teste tem de dizer isso em voz alta, e não passar por
    // um motivo que não é o que ele mede.
    const sessao = createClient(SB_URL, ANON, { auth: { persistSession: false } });
    const { error: loginErr } = await sessao.auth.signInWithPassword({
      email: escritorio.contadorEmail, password: SENHA_SINTETICA,
    });
    expect(loginErr, `login do contador falhou: ${loginErr?.message}`).toBeNull();
    const { error: apontarErr } = await sessao
      .from('profiles')
      .upsert({ user_id: escritorio.contadorId, current_company: cliente.companyId },
              { onConflict: 'user_id' });
    expect(
      apontarErr,
      'O contador NÃO conseguiu apontar current_company para a empresa da carteira. ' +
      'A 0100 deveria permitir (ramo da carteira) — se mudou, este arquivo precisa ser reescrito.',
    ).toBeNull();

    // Login pela TELA: é o fluxo que gera os cookies do @supabase/ssr que as
    // actions vão ler. Atalho aqui inventaria uma sessão que o app não produz.
    const page = await browser.newPage({ baseURL: BASE });
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(escritorio.contadorEmail);
    await page.locator('input[name="password"]').fill(SENHA_SINTETICA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    const cookies = await page.context().cookies();
    ctx = await pwRequest.newContext({ baseURL: BASE, storageState: { cookies, origins: [] } });
    await page.close();
  });

  test.afterAll(async () => {
    await ctx?.dispose();
    if (admin) await limparSemeado(admin, semeado, 'idor-titular');
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

  test('nenhuma action do titular opera a empresa do cliente', async () => {
    const vazamentos: string[] = [];
    for (const caso of CASOS) {
      const r = await chamar(caso.nome, caso.args);
      // A asserção é sobre a mensagem EXATA, não sobre "deu erro". Recusar por
      // falta de certificado, por competência inválida ou por RLS também
      // "falharia" — e nenhuma dessas provaria que a posse foi conferida. Só a
      // mensagem de `empresaDoDono` prova, e ela tem de vir ANTES de qualquer
      // efeito externo.
      if (!r.corpo.includes(MENSAGEM_NAO_E_DONO)) {
        vazamentos.push(`${caso.nome} — ${caso.oQue}: não recusou por posse (status ${r.status}) ` +
          `corpo=${r.corpo.slice(0, 200)}`);
      }
    }
    expect(vazamentos.join('\n')).toBe('');
  });

  // `uploadCertificadoAction` NÃO entra neste laço, e a ausência é deliberada.
  // Ela recebe `FormData`, e invocar uma Server Action de FormData pelo
  // protocolo `Next-Action` exige a codificação multipart que o Next monta a
  // partir de um `<form>` — montada à mão, a requisição morre em "Connection
  // closed" e o teste passaria a medir o decoder do framework em vez da defesa.
  // A ordem da guarda dela (posse ANTES da validação do arquivo, que é o que
  // fecha o achado) está provada em
  // `src/app/(auth)/(gated)/configuracoes/ordem-da-guarda.test.ts`, com
  // verificação por mutação.

  test('CONTROLE POSITIVO: a sessão é real e alcança a área do escritório', async () => {
    // Sem isto, todo "recusou" acima poderia ser só sessão inválida.
    const r = await ctx.get('/contador');
    expect(r.status(), 'a sessão não alcança /contador — os outros casos não provam nada').toBe(200);
  });
});
