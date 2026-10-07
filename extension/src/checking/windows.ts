/**
 * Checking a long document a window at a time (opt-in: `checking.progressive`).
 *
 * The first check of a document is the slow one: every prose range goes to
 * the engines, where any later check finds most of them in the core's result
 * cache (4000 lines: 3.5 s first, 78 ms after, release build). So only a
 * document's first check is split into byte windows, the one in view first,
 * each published as it lands; later checks are whole, and cheap.
 *
 * The core checks the ranges whose first byte is in the window, so a tiling
 * checks every range once (rust-core/src/prose/window.rs), and each window's
 * answer is the complete set of findings for its ranges: the document's
 * findings are the windows' answers put together.
 *
 * `checking.maxBytes` bounds how much of a document is checked at all: the
 * windows stop there, whole checks included.
 */

/** A half-open byte window `[start, end)` of a document's UTF-8 text. */
export interface ByteWindow {
    readonly start: number;
    readonly end: number;
}

/**
 * The windows to check `length` bytes in, `width` each: the one holding
 * `focus` (the cursor, or the top of the view) first, then the rest in
 * document order. Within `maxBytes` when that is above 0: ranges starting
 * past it are not checked.
 */
export function windowsFor(length: number, width: number, focus: number, maxBytes: number): ByteWindow[] {
    const limit = maxBytes > 0 ? Math.min(length, maxBytes) : length;
    if (width <= 0 || limit <= 0) return limit <= 0 ? [] : [{ start: 0, end: limit }];
    const windows: ByteWindow[] = [];
    for (let start = 0; start < limit; start += width) windows.push({ start, end: Math.min(start + width, limit) });
    const first = windows.findIndex((w) => focus >= w.start && focus < w.end);
    if (first <= 0) return windows;
    return [windows[first]!, ...windows.slice(0, first), ...windows.slice(first + 1)];
}

/**
 * The findings so far of a check made in windows: each window's answer, in
 * document order. A window answered again replaces its own answer only.
 */
export class WindowedFindings<T extends { readonly coreStartByte?: number }> {
    private readonly byWindow = new Map<number, readonly T[]>();

    /** Records `window`'s answer; returns all the findings so far, in document order. */
    add(window: ByteWindow, findings: readonly T[]): T[] {
        this.byWindow.set(window.start, findings);
        return [...this.byWindow.entries()]
            .sort(([a], [b]) => a - b)
            .flatMap(([, list]) => list);
    }

    /** How many windows have answered. */
    get answered(): number {
        return this.byWindow.size;
    }
}
