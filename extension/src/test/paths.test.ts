import * as path from 'path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { basename } from '../shared/paths';

describe('basename', () => {
    it('matches path.posix.basename on any slash-separated name', () => {
        const segment = fc.string({ unit: fc.constantFrom('a', 'b', '.', ' ', 'é', '-') });
        fc.assert(fc.property(fc.array(segment, { maxLength: 5 }), fc.boolean(), (parts, absolute) => {
            const name = (absolute ? '/' : '') + parts.join('/');
            expect(basename(name)).toBe(path.posix.basename(name));
        }));
    });

    it('ignores trailing separators of either kind, however many', () => {
        expect(basename('a/b///')).toBe('b');
        expect(basename('C:\\work\\main.tex\\/\\')).toBe('main.tex');
        expect(basename('/')).toBe('');
        // A long run of separators is trimmed in one pass (the former regex backtracked from every start).
        expect(basename(`${'/'.repeat(200_000)}x${'/'.repeat(200_000)}`)).toBe('x');
    });

    it('also ends a segment at a backslash, as on Windows', () => {
        expect(basename('C:\\work\\thesis\\main.tex')).toBe('main.tex');
        expect(basename('overleaf:/p1/doc-main%2Fmain.tex')).toBe('doc-main%2Fmain.tex');
    });
});
