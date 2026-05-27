import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Só testes unitários em src/. Os specs Playwright vivem em tests/ (npm run test:e2e).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
