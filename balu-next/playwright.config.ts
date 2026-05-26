import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  // Estes testes exigem "zero erro no console". O `next dev` emite ruído inerente
  // (Fast Refresh, dicas do React DevTools e mismatch de hydration por compilação
  // sob demanda) que gera falsos negativos. Por isso a suíte roda contra o BUILD
  // de produção. Local: reaproveita um servidor já no ar (rode `npm run start`);
  // CI: builda e sobe do zero.
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
