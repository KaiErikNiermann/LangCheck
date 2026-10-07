// The check every adapter makes before it edits: around each span, the text
// the client saw; no two edits over the same text.
import { expect, test } from 'vitest';
import { editsHold } from '../../src/editor/edits';
import type { TextEdit } from '../../src/editor/types';

/** An edit of `text` as the client would make it, with up to 3 characters of context either side. */
function editOf(text: string, from: number, to: number, insert: string): TextEdit {
    const context = 3;
    const expectedAt = Math.max(0, from - context);
    return { from, to, insert, expectedAt, expected: text.slice(expectedAt, to + context) };
}

const holds = (text: string, edits: TextEdit[]) => editsHold(edits, text.length, (from, to) => text.slice(from, to));

test('an edit holds while the text around it is what it was', () => {
    const seen = 'one teh two';
    expect(holds(seen, [editOf(seen, 4, 7, 'the')])).toBe(true);
});

test('an insertion is checked by its context: its own span is empty', () => {
    const seen = 'one two three';
    const comma = editOf(seen, 3, 3, ',');
    expect(holds(seen, [comma])).toBe(true);
    // Another file swapped in: the empty span still "matches", the context does not.
    expect(holds('something else', [comma])).toBe(false);
});

test('equal text at the same offset is not enough: its neighbours must match too', () => {
    const seen = 'xx teh yy';
    expect(holds('ab teh cd', [editOf(seen, 3, 6, 'the')])).toBe(false);
});

test('two edits over the same text, overlapping or at one point, are refused', () => {
    const seen = 'teh and teh';
    expect(holds(seen, [editOf(seen, 0, 3, 'the'), editOf(seen, 0, 3, 'the')])).toBe(false);
    expect(holds(seen, [editOf(seen, 0, 3, 'the'), editOf(seen, 2, 5, 'x')])).toBe(false);
    expect(holds(seen, [editOf(seen, 3, 3, ','), editOf(seen, 3, 3, ';')])).toBe(false);
    // Side by side is fine.
    expect(holds(seen, [editOf(seen, 0, 3, 'the'), editOf(seen, 8, 11, 'the')])).toBe(true);
    expect(holds(seen, [editOf(seen, 0, 3, 'the'), editOf(seen, 3, 4, '_')])).toBe(true);
});

test('an edit outside the text, or naming context it does not cover, is refused', () => {
    const seen = 'abc';
    expect(holds(seen, [{ from: 2, to: 5, insert: '', expectedAt: 2, expected: 'c' }])).toBe(false);
    expect(holds(seen, [{ from: 1, to: 2, insert: '', expectedAt: 2, expected: 'c' }])).toBe(false);
});
