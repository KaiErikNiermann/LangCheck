import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { byteDelta, rebaseSpan, type TextChange } from '../diagnostics/rebase';

const apply = (text: string, change: TextChange) => text.slice(0, change.start) + change.text + text.slice(change.end);

describe('rebaseSpan', () => {
    it('keeps a span before the edit, shifts one after it, drops one it touched', () => {
        // "We go alot and recieve it." with "alot" -> "a lot".
        const change = { start: 6, end: 10, text: 'a lot' };
        expect(rebaseSpan({ start: 0, end: 2 }, change)).toEqual({ start: 0, end: 2 });
        expect(rebaseSpan({ start: 15, end: 22 }, change)).toEqual({ start: 16, end: 23 });
        expect(rebaseSpan({ start: 6, end: 10 }, change)).toBeUndefined();
        expect(rebaseSpan({ start: 3, end: 8 }, change)).toBeUndefined();
    });

    it('puts text inserted at an edge outside the span', () => {
        const insert = { start: 5, end: 5, text: ',' };
        expect(rebaseSpan({ start: 0, end: 5 }, insert)).toEqual({ start: 0, end: 5 });
        expect(rebaseSpan({ start: 5, end: 9 }, insert)).toEqual({ start: 6, end: 10 });
    });

    it('a span the edit did not touch covers the same text afterwards', () => {
        const scenario = fc
            .string({ unit: 'grapheme', maxLength: 30 })
            .chain((text) =>
                fc.record({
                    text: fc.constant(text),
                    span: fc.tuple(fc.nat(text.length), fc.nat(text.length)).map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) })),
                    change: fc
                        .tuple(fc.nat(text.length), fc.nat(text.length), fc.string({ maxLength: 6 }))
                        .map(([a, b, inserted]) => ({ start: Math.min(a, b), end: Math.max(a, b), text: inserted })),
                }),
            );
        fc.assert(
            fc.property(scenario, ({ text, span, change }) => {
                const moved = rebaseSpan(span, change);
                if (moved === undefined) {
                    // Dropped only when the change reached into it.
                    expect(change.start < span.end && change.end > span.start || (change.start === change.end && change.start > span.start && change.start < span.end)).toBe(true);
                    return;
                }
                expect(apply(text, change).slice(moved.start, moved.end)).toBe(text.slice(span.start, span.end));
            }),
        );
    });
});

describe('byteDelta', () => {
    it('counts UTF-8 bytes, not UTF-16 units', () => {
        expect(byteDelta('teh', { start: 0, end: 3, text: 'the' })).toBe(0);
        expect(byteDelta('Wislawa', { start: 4, end: 5, text: 'ł' })).toBe(1);
        expect(byteDelta('a😀b', { start: 1, end: 3, text: '' })).toBe(-4);
    });
});
