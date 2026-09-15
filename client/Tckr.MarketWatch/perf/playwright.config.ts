import { defineConfig, devices } from '@playwright/test';

/**
 * The one recorded browser run for Phase 3 (README.md §4, key decision 10): Vitest
 * asserts the deterministic coalescing invariant on every CI run; this Playwright
 * config drives the real-browser frame-timing measurement that task 09 records into
 * docs/phase-3-web-client/results.md. No specs exist yet — task 09 adds
 * `frame-timing.spec.ts` alongside this file.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    cwd: '..',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
