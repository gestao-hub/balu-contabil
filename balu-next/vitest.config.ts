import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Só testes unitários em src/. Os specs Playwright vivem em tests/ (npm run test:e2e).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // No-op stub: server-only lança em Client Components, mas em vitest/node é inerte.
      'server-only': fileURLToPath(new URL('./src/__mocks__/server-only.ts', import.meta.url)),
    },
  },
});
