import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// PR 4.2 — passe de UX responsiva: 390×844 (iPhone 12/13/14, o corte que o card
// pede) em TODAS as rotas autenticadas.
//
// O QUE ISTO MEDE, e por que assim:
// o sintoma real de layout quebrado no celular é a PÁGINA rolar de lado — o
// usuário arrasta e o cabeçalho descola do conteúdo. Isso é
// `documentElement.scrollWidth > innerWidth`, e é objetivo. Julgar "está feio"
// por screenshot não é reproduzível e não falha sozinho no CI.
//
// A SUTILEZA QUE EVITA FALSO POSITIVO: uma tabela larga DENTRO de um
// `overflow-x-auto` é o padrão certo, não um defeito — ela rola sozinha e a
// página fica quieta. Por isso o diagnóstico ignora quem está contido num
// ancestral rolável e só acusa quem realmente empurra o documento.
//
// Bate no Supabase real (mesmo idioma de rls-contador.spec.ts), ator descartável.
// Rodar:
//   set -a; . ./.env.local; set +a; npx playwright test responsivo

// NÃO chamar de `URL`: isso sombreia o construtor global e quebra o
// `new URL(page.url())` lá embaixo com "URL is not a constructor".
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const STAMP = Date.now();
const PASS = 'senha-teste-responsivo-123';
const email = `resp-${STAMP}@balu-test.local`;
const emailContador = `resp-ct-${STAMP}@balu-test.local`;
const emailAdmin = `resp-ad-${STAMP}@balu-test.local`;

const MOBILE = { width: 390, height: 844 };

let userId = '';
let companyId = '';
let contadorId = '';
let adminId = '';
let contabilidadeId = '';

/** Rotas autenticadas de uma EMPRESA. As de contador/admin exigem outro papel
 *  e são varridas em blocos próprios abaixo. */
const ROTAS_EMPRESA = [
  '/',
  '/clientes',
  '/notas_fiscais',
  '/impostos',
  '/impostos/novo',
  '/impostos/folha',
  '/impostos/202601',
  '/honorarios',
  '/cobrancas',
  '/configuracoes',
  '/configuracoes/conciliacao',
  '/conta',
  '/conta/assinatura',
  '/notificacoes',
];

const ROTAS_CONTADOR = [
  '/contador',
  '/contador/clientes/novo',
  '/contador/aberturas',
  '/contador/honorarios',
  '/contador/cobrancas',
  '/contador/equipe',
  '/contador/atendimentos',
  '/contador/configuracoes',
  '/contador/configuracoes/avulsos',
  '/contador/assinatura',
];

const ROTAS_ADMIN = [
  '/admin',
  '/admin/empresas',
  '/admin/usuarios',
  '/admin/contabilidades',
  '/admin/assinaturas',
  '/admin/metricas',
  '/admin/explicacoes',
  '/admin/configuracoes',
  '/admin/configuracoes/ia',
  '/admin/configuracoes/parametros',
];

const ROTAS_PUBLICAS = ['/login', '/cadastro', '/reset_pw'];

/**
 * Alvos de toque pequenos demais. 24×24 CSS px é o mínimo da WCAG 2.5.8
 * (nível AA); abaixo disso o dedo erra e o usuário culpa o app.
 *
 * Só olha o que É clicável de verdade e está visível — ícone decorativo dentro
 * de um botão grande não é alvo, o botão é.
 */
async function medirAlvosPequenos(page: Page) {
  return page.evaluate(() => {
    const MIN = 24;
    const alvos = document.querySelectorAll('button, a[href], input[type="checkbox"], input[type="radio"], [role="button"]');
    const ruins: string[] = [];
    for (const el of Array.from(alvos)) {
      if (getComputedStyle(el).visibility === 'hidden') continue;
      // Um alvo dentro de outro alvo (ícone em botão) não conta em dobro.
      if (el.parentElement?.closest('button, a[href], [role="button"]')) continue;

      // UM CHECKBOX DENTRO DE <label> TEM O LABEL INTEIRO COMO ALVO: clicar no
      // texto alterna a caixa. Medir os 16px do quadradinho acusaria como
      // defeito o padrão que JÁ é acessível — e o "conserto" (inflar a caixa)
      // deixaria a tela pior sem ganho nenhum. A WCAG 2.5.8 isenta o alvo cuja
      // área clicável efetiva é maior.
      // Duas formas de associação contam: o label que ENVOLVE o input e o
      // `<label for="id">` que aponta para ele à distância. As duas tornam o
      // texto clicável, então as duas ampliam o alvo real.
      //
      // Só vale para checkbox/radio. Um LINK dentro de um label é alvo próprio
      // — clicar nele navega, não alterna a caixa —, e medi-lo pelo label
      // esconderia justamente o link fininho que queremos achar.
      const ehCaixa = el.matches('input[type="checkbox"], input[type="radio"]');
      const id = el.getAttribute('id');
      const rotulado = ehCaixa
        ? el.closest('label') ?? (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null)
        : null;
      const alvo = rotulado ?? el;
      const r = alvo.getBoundingClientRect();

      if (r.width === 0 || r.height === 0) continue; // escondido
      if (r.width >= MIN && r.height >= MIN) continue;
      const rotulo = (el.textContent ?? '').trim().slice(0, 30) || el.getAttribute('aria-label') || '(sem rótulo)';
      // O HTML do elemento vai junto: "(sem rótulo) 16×16px" não diz a ninguém
      // qual botão consertar, e o relatório vira trabalho em vez de conserto.
      ruins.push(`"${rotulo}" ${Math.round(r.width)}×${Math.round(r.height)}px → ${el.outerHTML.slice(0, 120)}`);
      if (ruins.length >= 6) break;
    }
    return ruins;
  });
}

/**
 * Mede o overflow horizontal e NOMEIA os culpados.
 * Retorna null quando a página se comporta.
 */
async function medirOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const largura = window.innerWidth;
    // 1px de tolerância: subpixel de borda/scrollbar não é defeito de layout.
    const excesso = doc.scrollWidth - largura;
    if (excesso <= 1) return null;

    // Um ancestral rolável ABSORVE o filho largo — quem está dentro de um não
    // é culpado pelo scroll da página.
    const dentroDeRolavel = (el: Element): boolean => {
      let p = el.parentElement;
      while (p && p !== doc) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
        p = p.parentElement;
      }
      return false;
    };

    const culpados: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= largura + 1) continue;
      if (dentroDeRolavel(el)) continue;
      const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
      culpados.push(`<${el.tagName.toLowerCase()} class="${cls}"> direita=${Math.round(r.right)}px`);
      if (culpados.length >= 5) break;
    }
    return { excesso, largura, scrollWidth: doc.scrollWidth, culpados };
  });
}

async function verificarRota(page: Page, rota: string, exigirAutenticada = false) {
  await page.setViewportSize(MOBILE);
  await page.goto(rota, { waitUntil: 'networkidle' });
  // O layout assenta depois de fontes/imagens; sem isso o rect mente.
  await page.waitForTimeout(300);

  // GUARDA CONTRA FALSO VERDE: se a sessão não colou, o gate redireciona para
  // /login ou /onboarding — telas simples, que passam no teste. Sem esta
  // checagem a varredura mediria a mesma página 14 vezes e ficaria verde sem
  // ter olhado nada. O teste precisa falhar quando não mediu o que prometeu.
  if (exigirAutenticada) {
    const atual = new URL(page.url()).pathname;
    // TODOS os destinos de gate entram aqui, não só /login. Cada um deles é uma
    // tela curta e simples que passaria no teste sem medir nada:
    //   /login, /onboarding      → (auth) e (gated) layouts
    //   /aceite                  → um único documento LGPD publicado sem aceite
    //                              manda TODAS as rotas para cá
    //   /contador/cadastro       → papel Contador sem escritório
    //   /contador/aguardando     → escritório pendente ou suspenso
    const GATES = /^\/(login|onboarding|aceite|contador\/(cadastro|aguardando))$/;
    expect(
      GATES.test(atual) || (atual !== rota && rota !== '/'),
      `${rota} terminou em ${atual} — a varredura não chegou a medir esta rota.`,
    ).toBe(false);
  }

  const r = await medirOverflow(page);
  expect(
    r,
    r
      ? `${rota} rola ${r.excesso}px de lado em 390px (scrollWidth=${r.scrollWidth}).\n` +
        `Culpados:\n  ${r.culpados.join('\n  ')}`
      : '',
  ).toBeNull();

  const pequenos = await medirAlvosPequenos(page);
  expect(
    pequenos,
    `${rota}: alvo de toque menor que 24×24px (WCAG 2.5.8).\n  ${pequenos.join('\n  ')}`,
  ).toEqual([]);
}

/** Roda uma lista inteira antes de falhar — parar na primeira rota
 *  transformaria o passe num jogo de bater-e-rodar-de-novo. */
async function varrer(page: Page, rotas: string[]) {
  const falhas: string[] = [];
  for (const rota of rotas) {
    try {
      await verificarRota(page, rota, true);
    } catch (e) {
      falhas.push(e instanceof Error ? e.message : String(e));
    }
  }
  expect(falhas.join('\n\n---\n\n')).toBe('');
}

async function entrar(page: Page, comoEmail: string) {
  await page.setViewportSize(MOBILE);
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(comoEmail);
  await page.locator('input[name="password"]').fill(PASS);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForLoadState('networkidle');
}

test.describe('UX responsiva — 390×844', () => {
  /**
   * Cria um usuário JÁ COM O PAPEL CERTO.
   *
   * O papel NÃO se insere à mão: o trigger `on_auth_user_created_role`
   * (migration 0002) insere em `role_types` no momento do createUser, lendo
   * `raw_user_meta_data->>'type'` e caindo em 'Empresa'. Um insert nosso depois
   * ou falha (a coluna é `type`, não `role_type`) ou cria uma SEGUNDA linha —
   * e `gate-context.ts` lê com `.maybeSingle()`, que ERRA com duas linhas,
   * derrubando o usuário inteiro.
   */
  async function criarAtor(mail: string, tipo: 'Empresa' | 'Contador' | 'AdminBalu') {
    const { data, error } = await admin.auth.admin.createUser({
      email: mail, password: PASS, email_confirm: true,
      user_metadata: { type: tipo },
    });
    expect(error, `createUser ${tipo} falhou: ${error?.message}`).toBeNull();
    const id = data.user!.id;

    // Confere o que o trigger REALMENTE gravou. Sem isto, um papel errado vira
    // varredura verde que não mediu o app daquele papel — foi exatamente o que
    // aconteceu na primeira versão deste arquivo.
    const { data: papel } = await admin
      .from('role_types').select('type').eq('user_id', id).maybeSingle();
    expect(papel?.type, `papel de ${mail} deveria ser ${tipo}`).toBe(tipo);
    await aceitarLgpd(id);
    return id;
  }

  /**
   * Registra o aceite dos documentos LGPD vigentes.
   *
   * SEM ISTO A VARREDURA NÃO MEDE NADA: `(gated)/layout.tsx` manda para
   * /aceite quando há qualquer documento publicado sem aceite na versão
   * vigente — e /aceite é uma tela curta que passa nas duas checagens. Não é
   * hipótese: com o banco atual, TODAS as 34 rotas autenticadas caíam lá.
   *
   * Mesma regra de `lib/lgpd/pendencia-aceite.ts`: vigente = a publicação mais
   * recente de cada tipo.
   */
  async function aceitarLgpd(uid: string) {
    const { data: docs } = await admin
      .from('documento_versoes')
      .select('tipo, versao, publicado_em')
      .not('publicado_em', 'is', null)
      .order('publicado_em', { ascending: false });

    const vigentes = new Map<string, string>();
    for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao as string);
    if (vigentes.size === 0) return;

    const linhas = [...vigentes].map(([tipo, versao]) => ({ user_id: uid, tipo, versao, ip: '127.0.0.1' }));
    const { error } = await admin.from('aceites').insert(linhas);
    expect(error, `insert aceites falhou: ${error?.message}`).toBeNull();
  }

  test.beforeAll(async () => {
    userId = await criarAtor(email, 'Empresa');

    const { data: c, error: cErr } = await admin.from('companies')
      .insert({ user_id: userId, nome: `Empresa Responsivo ${STAMP}` })
      .select('id').single();
    expect(cErr, `insert company falhou: ${cErr?.message}`).toBeNull();
    companyId = c!.id;

    // Upsert, não insert: nenhum trigger cria a linha de profiles hoje
    // (conferido no banco — `handle_new_user` não existe e o único trigger em
    // auth.users é o de papel), mas o upsert sobrevive caso um passe a criar.
    // Apoia-se no índice único profiles_user_id_uidx da migration 0083.
    // O erro É conferido: sem current_company o gated manda para /onboarding e
    // a varredura não mede nada.
    const { error: pErr } = await admin.from('profiles')
      .upsert({ user_id: userId, current_company: companyId }, { onConflict: 'user_id' });
    expect(pErr, `upsert profiles falhou: ${pErr?.message}`).toBeNull();

    const { error: efErr } = await admin.from('empresas_fiscais').insert({ empresa_id: companyId });
    expect(efErr, `insert empresas_fiscais falhou: ${efErr?.message}`).toBeNull();

    // --- contador: precisa de escritório APROVADO, senão para em /aguardando ---
    const { data: ct, error: ctErr } = await admin.from('contabilidades')
      .insert({ nome: `Escritório Responsivo ${STAMP}`, crc: `CRCR${STAMP}`, crc_uf: 'SP', status: 'aprovada' })
      .select('id').single();
    expect(ctErr, `insert contabilidade falhou: ${ctErr?.message}`).toBeNull();
    contabilidadeId = ct!.id;

    contadorId = await criarAtor(emailContador, 'Contador');
    const { error: mErr } = await admin.from('contabilidade_membros')
      .insert({ contabilidade_id: contabilidadeId, user_id: contadorId });
    expect(mErr, `insert contabilidade_membros falhou: ${mErr?.message}`).toBeNull();

    adminId = await criarAtor(emailAdmin, 'AdminBalu');
  });

  test.afterAll(async () => {
    // Ordem importa: as filhas primeiro, senão a FK barra.
    //
    // Cada passo RECLAMA quando falha. Silenciar aqui era pior do que parece:
    // este spec bate no Supabase compartilhado, então uma FK barrando o delete
    // deixa ator descartável acumulando no banco a cada execução — e ninguém
    // fica sabendo, porque o teste já passou.
    const restos: string[] = [];
    const limpar = async (rotulo: string, fn: () => Promise<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) restos.push(`${rotulo}: ${(error as { message?: string })?.message ?? String(error)}`);
    };

    const ids = [userId, contadorId, adminId].filter(Boolean);
    if (companyId) {
      await limpar('empresas_fiscais', () => admin.from('empresas_fiscais').delete().eq('empresa_id', companyId));
    }
    if (ids.length) {
      await limpar('aceites', () => admin.from('aceites').delete().in('user_id', ids));
      await limpar('profiles', () => admin.from('profiles').delete().in('user_id', ids));
      await limpar('role_types', () => admin.from('role_types').delete().in('user_id', ids));
    }
    if (contabilidadeId) {
      await limpar('contabilidade_membros', () => admin.from('contabilidade_membros').delete().eq('contabilidade_id', contabilidadeId));
    }
    if (companyId) await limpar('companies', () => admin.from('companies').delete().eq('id', companyId));
    if (contabilidadeId) await limpar('contabilidades', () => admin.from('contabilidades').delete().eq('id', contabilidadeId));

    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) restos.push(`deleteUser ${id}: ${error.message}`);
    }

    // Não derruba a suíte por causa da faxina — mas grita, para o lixo não
    // crescer em silêncio.
    if (restos.length) console.warn(`[responsivo] limpeza incompleta:\n  ${restos.join('\n  ')}`);
  });

  test('públicas', async ({ page }) => {
    for (const rota of ROTAS_PUBLICAS) await verificarRota(page, rota);
  });

  test('Empresa', async ({ page }) => {
    await entrar(page, email);
    await varrer(page, ROTAS_EMPRESA);
  });

  test('Contador', async ({ page }) => {
    await entrar(page, emailContador);
    await varrer(page, ROTAS_CONTADOR);
  });

  test('AdminBalu', async ({ page }) => {
    await entrar(page, emailAdmin);
    await varrer(page, ROTAS_ADMIN);
  });
});
