import { defineConfig } from '@vscode/test-cli';

/**
 * End-to-end tests: a real VS Code, this extension loaded, a real workspace.
 *
 * The unit tests under `src/test/*.test.ts` run in vitest and cover pure
 * logic. These cover what only a running editor can show -- whether a check
 * actually fired after a document opened, and whether anything was drawn --
 * which is where the startup races live.
 */
export default defineConfig({
    files: 'out/test/e2e/**/*.test.js',
    workspaceFolder: './src/test/fixtures/basic',
    mocha: {
        ui: 'tdd',
        // A check spans a subprocess launch and a dictionary load, so the
        // per-test timeouts are set in the tests themselves against what the
        // feature is held to. This is only a ceiling.
        timeout: 90_000,
    },
    launchArgs: [
        // Nothing else should be able to answer for a diagnostic or a hint, or
        // a green run would prove nothing about this extension.
        '--disable-extensions',
    ],
});
