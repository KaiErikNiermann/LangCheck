import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { alias: { vscode: new URL('src/shim/vscode.ts', import.meta.url).pathname } },
    define: { __LANGUAGE_CHECK_TEST__: 'false' },
    test: { include: ['test/unit/**/*.test.ts'] },
});
