import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { alias: { vscode: new URL('src/shim/vscode.ts', import.meta.url).pathname, path: 'path-browserify' } },
    define: { __LANGUAGE_CHECK_TEST__: 'false', __LANGUAGE_CHECK_VERSION__: JSON.stringify('0.0.0-test') },
    test: { include: ['test/unit/**/*.test.ts'] },
});
