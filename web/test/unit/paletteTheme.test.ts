// @vitest-environment happy-dom
// The palette theme as stored and as applied to the page.
import { describe, expect, test } from 'vitest';
import { applyTheme, parseTheme } from '../../src/palette/theme';

describe('parseTheme', () => {
    test.each([
        ['light', 'light'],
        ['dark', 'dark'],
        ['system', 'system'],
        [undefined, 'system'],
        ['solarized', 'system'],
        [42, 'system'],
    ])('%s is %s', (stored, theme) => {
        expect(parseTheme(stored)).toBe(theme);
    });
});

describe('applyTheme', () => {
    test('a picked theme is set on the root, and the system one clears it', () => {
        const root = document.createElement('html');
        applyTheme(root, 'dark');
        expect(root.dataset.theme).toBe('dark');
        applyTheme(root, 'system');
        expect(root.dataset.theme).toBeUndefined();
    });
});
