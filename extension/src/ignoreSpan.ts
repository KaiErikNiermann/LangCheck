/**
 * Silencing every engine over one span.
 *
 * "Ignore this issue" is keyed on the diagnostic's own message, so it
 * silences the one finding it was invoked on. A phrase that three engines all
 * dislike therefore takes three trips through the lightbulb, and the second
 * and third only appear once the one above has gone.
 *
 * This picks every diagnostic that touches the span instead. What counts as
 * touching is the whole decision, so it lives here where it can be tested
 * without an editor: a zero-width cursor has to reach the diagnostic it sits
 * inside, and a selection has to reach every diagnostic it crosses without
 * reaching the ones it merely abuts.
 */

/** The half-open offset range a diagnostic or a selection covers. */
export interface Span {
    readonly start: number;
    readonly end: number;
}

/**
 * Whether `diagnostic` is one the user means by selecting `selection`.
 *
 * Abutting does not count: a caret at the end of one word and the start of
 * the next would otherwise silence both, and the one it visually sits against
 * is not the one it is inside. A caret strictly inside a diagnostic does
 * count, which is the no-selection case and the common one.
 */
export function touches(selection: Span, diagnostic: Span): boolean {
    if (selection.start === selection.end) {
        // A caret: inside the diagnostic, or at its start. Its end belongs to
        // whatever comes next.
        return selection.start >= diagnostic.start && selection.start < diagnostic.end;
    }
    if (diagnostic.start === diagnostic.end) {
        return diagnostic.start >= selection.start && diagnostic.start < selection.end;
    }
    return selection.start < diagnostic.end && diagnostic.start < selection.end;
}

/** Every diagnostic the selection reaches, in document order. */
export function spanned<T extends Span>(selection: Span, diagnostics: readonly T[]): T[] {
    return diagnostics
        .filter(d => touches(selection, d))
        .sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * How many distinct engines are behind a set of diagnostics.
 *
 * The action is only worth offering when more than one finding is in range,
 * and worth *naming* engines when more than one engine is: "silence 3 issues
 * here" is the honest label either way, so this is only used to decide
 * whether to offer it at all.
 */
export function engines(ruleIds: readonly (string | undefined)[]): Set<string> {
    const found = new Set<string>();
    for (const id of ruleIds) {
        if (id === undefined || id === '') continue;
        found.add(id.split('.')[0] ?? id);
    }
    return found;
}
