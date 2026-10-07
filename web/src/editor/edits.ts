// The check every adapter makes before it edits (TextEdit).
import type { TextEdit } from './types';

/** Characters of context either side of an edit's span that must still match. */
export const EDIT_CONTEXT_CHARS = 16;

/**
 * Whether `edits` may be applied to a text `length` long, read through
 * `slice`: each within the text, around its span what the client saw there,
 * and no two touching the same text -- edits a batch applies cumulatively,
 * so two over one span would replace it twice ("teh" becoming "thethe").
 */
export function editsHold(edits: readonly TextEdit[], length: number, slice: (from: number, to: number) => string): boolean {
    const ordered = edits.toSorted((a, b) => a.from - b.from);
    let reached = -1;
    for (const e of ordered) {
        const expectedEnd = e.expectedAt + e.expected.length;
        if (e.from < 0 || e.to < e.from || e.to > length || e.expectedAt < 0 || e.expectedAt > e.from || expectedEnd < e.to || expectedEnd > length) return false;
        // Overlapping, or two at one point (in which order?): neither applies.
        if (e.from < reached || (e.from === reached && e.from === e.to)) return false;
        if (slice(e.expectedAt, expectedEnd) !== e.expected) return false;
        reached = Math.max(reached, e.to);
    }
    return true;
}
