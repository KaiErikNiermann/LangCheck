import { describe, expect, it } from 'vitest';

import { parseDebounceMs, DEFAULT_DEBOUNCE_MS } from '../configParsing';

describe('parseDebounceMs', () => {
    it('reads the value the config sets', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: 900\n')).toBe(900);
    });

    it('falls back when the config says nothing', () => {
        expect(parseDebounceMs('engines:\n  harper:\n    enabled: true\n'))
            .toBe(DEFAULT_DEBOUNCE_MS);
    });

    it('falls back on a value that is not a number', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: soon\n'))
            .toBe(DEFAULT_DEBOUNCE_MS);
    });

    it('accepts zero, which means check on every change', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: 0\n')).toBe(0);
    });

    it('ignores the key inside a comment', () => {
        expect(parseDebounceMs('# debounce_ms: 42\n')).toBe(DEFAULT_DEBOUNCE_MS);
    });
});
