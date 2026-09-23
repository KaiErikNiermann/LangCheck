import { defineConfig } from '@playwright/test';

/**
 * UI tests: a real VS Code window driven through its DOM, for what the
 * extension-host e2e suite cannot reach -- the webviews. Each test launches
 * its own window on a fresh copy of a fixture, so they run one at a time.
 */
export default defineConfig({
    testDir: './src/test/ui',
    testMatch: '*.spec.ts',
    timeout: 120_000,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    outputDir: '.vscode-test/ui-results',
    use: { trace: 'retain-on-failure' },
});
