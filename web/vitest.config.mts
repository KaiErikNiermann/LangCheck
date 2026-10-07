import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { alias: { vscode: new URL('src/shim/vscode.ts', import.meta.url).pathname } },
    test: { include: ['test/unit/**/*.test.ts'] },
});
