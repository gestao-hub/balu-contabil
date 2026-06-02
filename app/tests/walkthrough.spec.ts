import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.join(__dirname, '..', 'screenshots', 'walkthrough');
fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  { name: '01-login',                url: '/login' },
  { name: '02-cadastro',             url: '/cadastro' },
  { name: '03-reset-request',        url: '/reset_pw' },
  { name: '04-reset-update',         url: '/reset_pw?code=dummy' },
  { name: '05-root-redirect',        url: '/' },                       // → /login
  { name: '06-clientes-redirect',    url: '/clientes' },               // → /login
  { name: '07-configuracoes-redir',  url: '/configuracoes' },          // → /login
  { name: '08-notas-redirect',       url: '/notas_fiscais' },          // → /login
  { name: '09-impostos-redirect',    url: '/impostos' },               // → /login
  { name: '10-not-found',            url: '/rota-inexistente-xyz' },
];

test.describe('Balu — walkthrough completo', () => {
  for (const { name, url } of PAGES) {
    test(`${name} — ${url}`, async ({ page }) => {
      const consoleErrs: string[] = [];
      page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()));
      page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${e.message}`));

      const resp = await page.goto(url, { waitUntil: 'networkidle' });
      // status pode ser 200 (públicas) ou seguir redirect (protegidas)
      expect(resp).toBeTruthy();

      // viewport desktop
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: path.join(SHOTS, `${name}-desktop.png`), fullPage: true });

      // viewport mobile (regressão mobile do Balu)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, `${name}-mobile.png`), fullPage: true });

      const critical = consoleErrs.filter((e) =>
        !e.includes('favicon') &&
        !e.includes('source map') &&
        !e.includes('DevTools') &&
        !e.includes('Failed to load resource') &&  // recursos estáticos 404 não bloqueiam
        !e.includes('useFormState')                 // warning de React 19, já migrado
      );
      if (critical.length > 0) console.log(`⚠ ${url}:`, critical.slice(0, 3));
      expect(critical, `Console errors em ${url}`).toEqual([]);
    });
  }
});

test('interação: preencher login form (sem submit, Supabase é dummy)', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill('luan@grupoidecomunicacao.com');
  await page.locator('input[name="password"]').fill('senha-teste-123');
  await page.screenshot({ path: path.join(SHOTS, '11-login-preenchido.png'), fullPage: true });
});

test('interação: preencher cadastro', async ({ page }) => {
  await page.goto('/cadastro');
  await page.locator('input[name="full_name"]').fill('Luan Bonadie').catch(() => {});
  await page.locator('input[name="email"]').fill('novo@balu.com');
  await page.locator('input[name="password"]').fill('senha-forte-123');
  await page.screenshot({ path: path.join(SHOTS, '12-cadastro-preenchido.png'), fullPage: true });
});
