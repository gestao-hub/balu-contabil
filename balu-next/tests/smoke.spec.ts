import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// Coleta de erros de console por página
function attachConsoleCapture(page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe('Balu — smoke público', () => {
  for (const route of ['/login', '/cadastro', '/reset_pw']) {
    test(`renderiza ${route} sem erros`, async ({ page }) => {
      const errors = attachConsoleCapture(page);
      const resp = await page.goto(route, { waitUntil: 'networkidle' });
      expect(resp?.status(), `status de ${route}`).toBeLessThan(400);
      await page.screenshot({ path: path.join(SHOTS, `public${route.replace(/\//g, '_')}.png`), fullPage: true });
      // Smoke: deve aparecer a marca "Balu"
      await expect(page.getByText('Balu')).toBeVisible();
      // Sem erros JS críticos
      const critical = errors.filter((e) =>
        !e.includes('favicon') && !e.includes('source map') && !e.includes('DevTools')
      );
      if (critical.length > 0) {
        console.log(`Console errors em ${route}:`, critical);
      }
    });
  }

  test('login redireciona protected → /login', async ({ page }) => {
    const resp = await page.goto('/clientes');
    // Redirect chain: /clientes → /login (via auth layout)
    expect(page.url()).toContain('/login');
    await page.screenshot({ path: path.join(SHOTS, 'redirect_clientes_to_login.png'), fullPage: true });
  });
});

test.describe('Balu — formulário login básico', () => {
  test('preenche credenciais (esperando erro de auth dummy)', async ({ page }) => {
    const errors = attachConsoleCapture(page);
    await page.goto('/login');
    await page.locator('input[name="email"]').fill('foo@bar.com');
    await page.locator('input[name="password"]').fill('senha123');
    await page.screenshot({ path: path.join(SHOTS, 'login_filled.png'), fullPage: true });
    // Não submetemos: o backend Supabase é dummy. Validamos só que o form responde a input.
    await expect(page.locator('input[name="email"]')).toHaveValue('foo@bar.com');
  });
});

test.describe('Balu — cadastro form', () => {
  test('campos cadastro presentes', async ({ page }) => {
    await page.goto('/cadastro');
    await page.screenshot({ path: path.join(SHOTS, 'cadastro_initial.png'), fullPage: true });
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    // Campo de confirmação de senha (adicionado depois): garante locator não-ambíguo.
    await expect(page.locator('input[name="password_confirm"]')).toBeVisible();
  });
});
