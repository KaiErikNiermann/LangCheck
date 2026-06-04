/**
 * Pure formatting logic for suggestion inlay hints.
 *
 * Kept free of any `vscode` import so it can be unit-tested directly; the
 * extension wraps it with the document text for the diagnostic range.
 */

export interface InlayLabel {
    /** The text shown in the editor (already prefixed with " → "). */
    label: string;
    /** The replacement text actually applied when the hint is accepted. */
    applyValue: string;
}

/** Render whitespace as visible glyphs so it isn't invisible in a hint. */
export function visualizeWhitespace(s: string): string {
    return s
        .replace(/ /g, '␣')
        .replace(/\t/g, '⇥')
        .replace(/\r/g, '')
        .replace(/\n/g, '⏎');
}

/**
 * Describe a whitespace-only correction in words instead of rendering the
 * (invisible) literal characters, e.g. "  " → " " reads as "remove extra
 * space" rather than the confusing "  →  ".
 */
export function describeWhitespaceFix(original: string, suggestion: string): string {
    // Pure-space run shortened to a pure-space run (the common redundant-space
    // case from "too many spaces" lints).
    if (/^ +$/.test(original) && /^ +$/.test(suggestion)) {
        const delta = original.length - suggestion.length;
        if (suggestion.length === 1 && delta > 0) {
            return delta === 1 ? ' → remove extra space' : ` → remove ${delta} extra spaces`;
        }
        if (delta > 0) {
            return ` → ${suggestion.length} space${suggestion.length === 1 ? '' : 's'}`;
        }
    }
    // Any other whitespace-only change (tabs, newlines, mixed): show it with
    // visible glyphs.
    return ` → "${visualizeWhitespace(suggestion)}"`;
}

/**
 * Format a diagnostic suggestion into an inlay hint label + apply value.
 *
 * `originalText` is the document text under the diagnostic range; `suggestion`
 * is the engine's first suggestion (or `undefined` if there is none).
 */
export function formatSuggestionLabel(
    originalText: string,
    suggestion: string | undefined
): InlayLabel | null {
    if (suggestion === undefined) return null;

    // Harper "Insert ..." pattern (e.g. Insert "comma").
    const insertMatch = suggestion.match(/^Insert "(.+)"$/);
    if (insertMatch) {
        const inserted = insertMatch[1]!;
        const shown = inserted.trim() === '' ? visualizeWhitespace(inserted) : inserted;
        return { label: ` → insert ${shown}`, applyValue: suggestion };
    }

    // Deletion — empty suggestion.
    if (suggestion === '') {
        return { label: ' → (remove)', applyValue: '' };
    }

    // Whitespace-only correction — describe it rather than show invisible chars.
    if (originalText.trim() === '' && suggestion.trim() === '') {
        return { label: describeWhitespaceFix(originalText, suggestion), applyValue: suggestion };
    }

    // Punctuation insertion — suggestion is original + trailing punctuation.
    if (originalText.length > 0 && suggestion.startsWith(originalText) && suggestion.length > originalText.length) {
        const added = suggestion.slice(originalText.length);
        if (/^[.,;:!?'"\-–—]+$/.test(added)) {
            return { label: ` → insert "${added}"`, applyValue: suggestion };
        }
    }

    // Punctuation removal — original is suggestion + trailing punctuation.
    if (suggestion.length > 0 && originalText.startsWith(suggestion) && originalText.length > suggestion.length) {
        const removed = originalText.slice(suggestion.length);
        if (/^[.,;:!?'"\-–—]+$/.test(removed)) {
            return { label: ` → remove "${removed}"`, applyValue: suggestion };
        }
    }

    // Default — show the raw suggestion.
    return { label: ` → ${suggestion}`, applyValue: suggestion };
}
