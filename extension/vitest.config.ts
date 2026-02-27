import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: ['node_modules', 'out', 'webview'],
        include: ['src/**/*.test.ts'],
    },
});
