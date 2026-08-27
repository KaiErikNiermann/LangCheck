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
        exclude: ['node_modules', 'out', 'webview'],
        include: ['src/**/*.test.ts'],
    },
});
