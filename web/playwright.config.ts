import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;

export default defineConfig({
    testDir: 'test/e2e',
    globalSetup: './test/e2e/globalSetup.ts',
    fullyParallel: true,
    // Each test runs its own browser, native host and core server.
    workers: 3,
    // A flaky test is a bug: never retry silently.
    retries: 0,
    timeout: 60_000,
    reporter: [['list']],
    use: { trace: 'retain-on-failure' },
    projects: [
        // The whole path: extension, native host and core. Chromium only:
        // Playwright cannot load an extension into Firefox.
        // A test's first answer comes from a cold core (a debug build starting
        // its server and loading Harper's dictionary), and three tests start
        // one at once: past 5 s under that load was seen (typing test, after
        // a 500 ms pause). The budget covers the cold start, not a slow check.
        { name: 'real-path', testMatch: 'realPath*.spec.ts', expect: { timeout: 15_000 } },
        // The page-world half against a stub core, on both engines.
        { name: 'page-chromium', testMatch: 'pageLayer.spec.ts', use: { ...devices['Desktop Chrome'] } },
        { name: 'page-firefox', testMatch: 'pageLayer.spec.ts', use: { ...devices['Desktop Firefox'] } },
    ],
    webServer: {
        command: 'node test/e2e/server.mjs',
        env: { PORT: String(PORT) },
        url: `http://127.0.0.1:${String(PORT)}/project/ready`,
        reuseExistingServer: false,
    },
});
