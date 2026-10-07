import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { WindowedFindings, windowsFor } from '../checking/windows';

describe('windowsFor', () => {
    it('tiles the document, the window in view first', () => {
        expect(windowsFor(25, 10, 0, 0)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 25 }]);
        expect(windowsFor(25, 10, 14, 0)).toEqual([{ start: 10, end: 20 }, { start: 0, end: 10 }, { start: 20, end: 25 }]);
    });

    it('stops at the bound, and checks nothing of an empty document', () => {
        expect(windowsFor(25, 10, 0, 12)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 12 }]);
        expect(windowsFor(0, 10, 0, 0)).toEqual([]);
        // A width of 0 is no windows at all: one, the bounded whole.
        expect(windowsFor(25, 0, 0, 12)).toEqual([{ start: 0, end: 12 }]);
    });

    it('covers [0, limit) exactly once, whatever the sizes and the focus', () => {
        fc.assert(
            fc.property(fc.nat(10_000), fc.integer({ min: 1, max: 3000 }), fc.nat(12_000), fc.nat(12_000), (length, width, focus, maxBytes) => {
                const windows = windowsFor(length, width, focus, maxBytes);
                const limit = maxBytes > 0 ? Math.min(length, maxBytes) : length;
                const sorted = [...windows].sort((a, b) => a.start - b.start);
                let at = 0;
                for (const w of sorted) {
                    expect(w.start).toBe(at);
                    expect(w.end).toBeGreaterThan(w.start);
                    at = w.end;
                }
                expect(at).toBe(limit);
            }),
        );
    });
});

describe('WindowedFindings', () => {
    it('puts the windows\' answers together in document order, whatever order they land in', () => {
        const found = new WindowedFindings<{ coreStartByte: number; id: string }>();
        found.add({ start: 10, end: 20 }, [{ coreStartByte: 12, id: 'b' }]);
        expect(found.add({ start: 0, end: 10 }, [{ coreStartByte: 3, id: 'a' }]).map((f) => f.id)).toEqual(['a', 'b']);
        // Answered again: that window's findings only are replaced.
        expect(found.add({ start: 10, end: 20 }, []).map((f) => f.id)).toEqual(['a']);
        expect(found.answered).toBe(2);
    });
});
