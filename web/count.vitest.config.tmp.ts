import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts', './tests/_count_setup_tmp.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 60000,
  },
});
