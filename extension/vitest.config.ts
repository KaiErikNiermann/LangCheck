import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // `vscode` is injected by the extension host and has no npm package,
            // so anything importing it fails to resolve under vitest.
            vscode: path.resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
        },
    },
    test: {
        // src/test/e2e runs inside a real VS Code under @vscode/test-cli, with
        // the genuine `vscode` API rather than the mock aliased above. Vitest
        // cannot run those and should not try to collect them.
        exclude: ['node_modules', 'out', 'webview', 'src/test/e2e/**'],
        include: ['src/**/*.test.ts'],
    },
});
