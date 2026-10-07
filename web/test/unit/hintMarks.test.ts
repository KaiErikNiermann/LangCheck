// Inlay hints hang off a real character next to their position, never off
// half a surrogate pair, and never off nothing.
import { Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { hintMarks } from '../../src/editor/cm6Adapter';

const doc = (s: string): Text => Text.of(s.split('\n'));
const isSurrogate = (unit: number): boolean => unit >= 0xD8_00 && unit <= 0xDF_FF;

test('after the previous character, before the next at a line start, nothing on an empty line', () => {
    const text = doc('ab\n\ncd');
    const marks = hintMarks(text, [{ at: 2, label: 'x' }, { at: 3, label: 'y' }, { at: 4, label: 'z' }], Decoration);
    expect(marks.map((m) => [m.from, m.to, m.value.spec.class as string])).toEqual([
        [1, 2, 'lc-hint-after'],
        [4, 5, 'lc-hint-before'],
    ]);
});

test('hints at one position share one mark', () => {
    const marks = hintMarks(doc('ab'), [{ at: 2, label: 'x' }, { at: 2, label: 'y' }], Decoration);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.value.spec.attributes['data-lc-hint']).toBe('x y');
});

test('any position in any text: a valid, non-empty range on one line whose edges are character boundaries', () => {
    const text = fc.string({ unit: fc.constantFrom('a', '\n', '😀', 'é') });
    // Inside a pair: a low surrogate preceded by a high one.
    const insidePair = (s: string, i: number): boolean => i > 0 && i < s.length && isSurrogate(s.charCodeAt(i)) && s.charCodeAt(i) >= 0xDC_00 && s.charCodeAt(i - 1) < 0xDC_00 && isSurrogate(s.charCodeAt(i - 1));
    fc.assert(
        fc.property(text, fc.nat(), (s, n) => {
            const at = n % (s.length + 1);
            const marks = hintMarks(doc(s), [{ at, label: 'h' }], Decoration);
            expect(marks.length).toBeLessThanOrEqual(1);
            for (const mark of marks) {
                expect(mark.to).toBeGreaterThan(mark.from);
                expect(s.slice(mark.from, mark.to)).not.toContain('\n');
                expect(insidePair(s, mark.from) || insidePair(s, mark.to)).toBe(false);
                expect(Math.abs(mark.from - at) <= 2 || Math.abs(mark.to - at) <= 2).toBe(true);
            }
        }),
    );
});

test('positions outside the document are dropped', () => {
    expect(hintMarks(doc('ab'), [{ at: -1, label: 'x' }, { at: 3, label: 'y' }], Decoration)).toEqual([]);
});
