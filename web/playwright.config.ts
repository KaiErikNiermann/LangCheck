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
        { name: 'real-path', testMatch: 'realPath.spec.ts' },
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
