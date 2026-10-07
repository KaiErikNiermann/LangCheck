/**
 * Moving findings over an edit the extension made itself, the way an editor
 * moves its markers: a finding before the edit stays, one after it shifts by
 * the length the edit added, and one the edit touched is dropped (its text
 * is gone). Offsets are half-open, `[start, end)`.
 */

/** One replacement of the text in `[start, end)` by `text`, in UTF-16 offsets of the text before it. */
export interface TextChange {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export interface Span {
    readonly start: number;
    readonly end: number;
}

/**
 * Where `span` is after `change`, or `undefined` when the change overlapped
 * it. Text inserted exactly at a span's edge lands outside it: before a span
 * that starts there, after one that ends there.
 */
export function rebaseSpan(span: Span, change: TextChange): Span | undefined {
    if (span.end <= change.start) return span;
    if (span.start >= change.end) {
        const delta = change.text.length - (change.end - change.start);
        return { start: span.start + delta, end: span.end + delta };
    }
    return undefined;
}

const utf8 = new TextEncoder();

/** How many UTF-8 bytes `change` adds to `before` (negative when it removes): what the core's byte offsets after it shift by. */
export function byteDelta(before: string, change: TextChange): number {
    return utf8.encode(change.text).length - utf8.encode(before.slice(change.start, change.end)).length;
}
