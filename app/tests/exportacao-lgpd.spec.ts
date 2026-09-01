import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { ambienteDestrutivo, MOTIVO_SKIP } from './guarda-ambiente';
import { criarEmpresario, criarCliente, limparSemeado, SENHA_SINTETICA, type Semeado } from './tenant-sintetico';

/**
 * EXPORTAÇÃO DE DADOS DA LGPD (art. 18) — o download acontece de verdade?
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 * A auditoria funcional de 29/08/2026 listou a exportação em "não testadas",
 * com a observação de que "o clique testado anteriormente não produziu download
 * nem requisição observável". Foi o ÚNICO item daquela lista que podia ser
 * defeito de código em vez de falta de credencial — e ficou sem resposta,
 * porque ninguém clicou de novo.
 *
 * Ler o código não resolve: `ExportarDadosButton` monta um Blob no cliente e
 * dispara `a.click()`, e essa é exatamente a construção que um navegador
 * automatizado engole sem sinal visível quando não está preparado para receber
 * download. Ou seja, as duas hipóteses — produto quebrado e ferramenta de
 * auditoria cega — produzem a MESMA observação. Só um teste que aceita download
 * separa as duas.
 *
 * O que este teste prova, na ordem: a action responde, o arquivo chega, o nome é
 * o esperado, o conteúdo é JSON válido, e traz os dados do usuário. E o que ele
 * prova de mais importante: que NENHUM segredo vai junto — a tela promete
 * "credenciais e certificados nunca são incluídos", e promessa de LGPD sem
 * teste é só texto.
 */
const AMBIENTE = ambienteDestrutivo();
test.skip(() => !AMBIENTE, MOTIVO_SKIP);

test.describe('Exportação LGPD (art. 18)', () => {
  test.describe.configure({ mode: 'serial' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any;
  const semeado: Semeado = {};
  let dono: Awaited<ReturnType<typeof criarEmpresario>>;

  test.beforeAll(async () => {
    admin = createClient(AMBIENTE!.url, AMBIENTE!.service, { auth: { persistSession: false } });
    dono = await criarEmpresario(admin, 'lgpd-export', semeado);
    // Uma linha filha para o JSON ter o que carregar: exportação vazia passaria
    // no teste sem provar que a consulta por empresa funciona.
    await criarCliente(admin, dono, semeado);
  });

  test.afterAll(async () => {
    if (admin) await limparSemeado(admin, semeado, 'exportacao-lgpd');
  });

  test('o clique baixa um JSON com os dados do usuário — e sem segredo nenhum', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(dono.email);
    await page.locator('input[name="password"]').fill(SENHA_SINTETICA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    // `?tab=seguranca` e não `/conta` puro: o botão vive na aba Segurança
    // (conta/page.tsx:72), ao lado da troca de senha e da exclusão de conta. A
    // primeira versão deste teste abriu `/conta` e não achou o botão — que é,
    // por sinal, um jeito plausível de a auditoria ter concluído que o clique
    // "não produziu nada".
    await page.goto('/conta?tab=seguranca');
    // Guarda contra falso verde: sem esta asserção, um redirect para /aceite ou
    // /onboarding deixaria o `waitForEvent` estourar por timeout e o motivo
    // seria "download não veio" — o diagnóstico errado, de novo.
    await expect(page).toHaveURL(/\/conta/, { timeout: 15_000 });

    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: /exportar meus dados/i }).click();
    const arquivo = await download;

    expect(arquivo.suggestedFilename()).toBe('meus-dados-balu.json');

    const caminho = await arquivo.path();
    expect(caminho, 'o download não produziu arquivo em disco').toBeTruthy();
    const bruto = (await import('node:fs')).readFileSync(caminho!, 'utf8');

    const json = JSON.parse(bruto) as Record<string, unknown>;
    expect(Object.keys(json).length, 'JSON vazio').toBeGreaterThan(0);
    expect(bruto).toContain(dono.email);
    expect(bruto).toContain(dono.nomeEmpresa);

    // A PROMESSA DA TELA, COBRADA. "Credenciais e certificados nunca são
    // incluídos" — se um dia uma tabela nova entrar na exportação trazendo
    // coluna de segredo junto, é aqui que aparece, e não num vazamento.
    for (const proibido of [
      'token_hom_cifrado', 'token_prod_cifrado', 'cert_password', 'senha_certificado',
      'arquivo_certificado_base64', 'service_role', 'nfse_senha_login', 'senha_responsavel',
      'enc:v1:',
    ]) {
      expect(bruto, `a exportação carregou "${proibido}"`).not.toContain(proibido);
    }
  });
});
