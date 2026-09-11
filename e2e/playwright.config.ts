import { defineConfig } from '@playwright/test';
import { fileURLToPath, URL } from 'node:url';

// This environment installs only the headless-shell browser + a hand-picked lib
// set (see e2e/README.md); skip Playwright's full host-requirements probe.
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

/**
 * Real-browser regression for the Shared Chat open/scroll lifecycle.
 *
 * The jsdom component tests missed the production "chat opens above the latest
 * message" bug twice, because jsdom does not clamp `scrollTop`, has no real
 * layout engine, and no `ResizeObserver` timing. This suite mounts the REAL
 * `ChatPanel` (real Sheet portal, real CSS, real scroll container, real RO) via
 * a fixture-driven harness (`e2e/harness/`) and drives it with Chromium.
 *
 * LOCAL ONLY — needs a browser binary. Not wired into the standard CI
 * (`Database Tests` / Vitest); run with `npm run test:e2e`. The
 * `LD_LIBRARY_PATH` shim for a sandboxed environment is documented in
 * `e2e/README.md`.
 */
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        baseURL: 'http://127.0.0.1:5199',
        browserName: 'chromium',
        // iPhone-13-class viewport (WebKit device preset can't run headless
        // here — Chromium at this size + DPR is the closest available proxy).
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: ['--no-sandbox', '--disable-gpu'] },
      },
    },
  ],
  webServer: {
    command: 'npx vite --config e2e/harness/vite.config.ts',
    url: 'http://127.0.0.1:5199/e2e/harness/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
