import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the PRODUCTION BUILD, not the dev server.
 *
 * That matters: the dev server transpiles on the fly and tolerates things a
 * real deploy does not. Testing `dist` is the only way to catch a broken
 * `base` path, a worker chunk that fails to instantiate, a missing asset, or a
 * CSS file that never got emitted.
 */
export default defineConfig({
  testDir: './e2e',
  // The full-space run genuinely takes a few seconds; allow for it.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4319',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4319 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4319/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
