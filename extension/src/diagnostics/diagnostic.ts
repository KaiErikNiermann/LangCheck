/**
 * The extension's diagnostic, and the small facts about one that several
 * features need: its rule id, whether it is a spelling finding, the id the
 * webviews and hints refer to it by, and how a suggestion becomes an edit.
 */
import type * as vscode from 'vscode';

import type { ByteOffset } from '../checking/offsets';

export interface ExtendedDiagnostic extends vscode.Diagnostic {
    suggestions?: string[];
    confidence?: number;
    /** Original byte offsets from the core, needed for fingerprint matching. */
    coreStartByte?: ByteOffset;
    coreEndByte?: ByteOffset;
    /**
     * The natural language this diagnostic is about, set by the core for the
     * ones that concern a language rather than a word.
     *
     * Read from the wire rather than recovered from the message: a tag parsed
     * out of prose is exactly where a spurious install prompt would come from.
     */
    language?: string;
    /** Whether a dictionary pack for `language` can be fetched. */
    packInstallable?: boolean;
    /**
     * The category the core sorted this into, e.g. `typography.capitalization`.
     *
     * Kept because `rules:` may silence a diagnostic by its category instead
     * of by the native id on `code`, and the editor has to be able to apply
     * the same filter the core would.
     */
    unifiedId?: string;
}

/**
 * The rule id on a diagnostic, or `fallback` when it has none.
 *
 * `code` is only ever set to a non-empty rule id string, so the fallback is
 * what callers see for a diagnostic the core gave no rule. The callers differ
 * on what that should read as (`''`, `'unknown'`, `undefined`), which is why
 * it is a parameter.
 */
export function ruleIdOf<F extends string | undefined>(diagnostic: { readonly code?: unknown }, fallback: F): string | F {
    const code = diagnostic.code;
    return typeof code === 'string' && code !== '' ? code : fallback;
}

export function isSpellingRule(ruleId: string): boolean {
    return ruleId.includes('Spell') || ruleId.includes('spell') || ruleId.includes('MORFOLOGIK');
}

export function getDiagnosticWord(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): string {
    return document.getText(diagnostic.range);
}

/**
 * Whether a diagnostic is a spelling finding on exactly `word`, case and all.
 *
 * Case-sensitive on purpose: this is what "fix all" matches on, and it must not
 * rewrite a capitalised occurrence with a lowercase replacement. The dictionary
 * paths compare lowercased words and do not use this.
 */
export function isSpellingOf(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, word: string): boolean {
    return isSpellingRule(ruleIdOf(diagnostic, '')) && getDiagnosticWord(document, diagnostic) === word;
}

declare const diagIdBrand: unique symbol;

/**
 * The id a hint, a code action or a webview uses for one diagnostic: which
 * of the document's lists it came from (the store's generation) and its
 * position in that list, as `diag-G-N`.
 *
 * The generation is what makes an id safe to act on later: a list is
 * replaced on every check and every optimistic removal, and position N of
 * the new list is a different finding. An id from an older list resolves to
 * nothing (DiagnosticStore.resolve) instead of to whatever moved into its
 * place.
 *
 * Only {@link diagId} makes one. Every id the extension receives back (a
 * command argument, a webview message) is one it handed out, and typing it so
 * keeps an unrelated string, say a rule id, from being passed where an index
 * is meant.
 */
export type DiagId = string & { readonly [diagIdBrand]: true };

/** The id for the diagnostic at `index` of the list of `generation`. */
export function diagId(generation: number, index: number): DiagId {
    return `diag-${generation}-${index}` as DiagId;
}

/** The generation and index back out of a {@link diagId}, or `undefined` for anything else. */
export function parseDiagId(id: string): { readonly generation: number; readonly index: number } | undefined {
    const match = /^diag-(\d{1,15})-(\d{1,15})$/u.exec(id);
    return match === null ? undefined : { generation: Number(match[1]), index: Number(match[2]) };
}

/**
 * The text an `Insert "x"` suggestion inserts, or `null` for any other one.
 *
 * LanguageTool words some fixes as an instruction rather than a replacement,
 * and replacing the flagged range with the literal instruction text would be
 * wrong.
 */
export function insertedText(suggestion: string): string | null {
    const insertMatch = suggestion.match(/^Insert\s+[""\u201C](.+)[""\u201D]$/);
    return insertMatch && insertMatch[1] ? insertMatch[1] : null;
}

/**
 * Add a suggestion to `edit`: an insertion at the end of the range for an
 * `Insert "x"` suggestion, otherwise a replacement of the range (an empty
 * suggestion deletes it).
 */
export function addSuggestionEdit(edit: vscode.WorkspaceEdit, uri: vscode.Uri, range: vscode.Range, suggestion: string): void {
    const inserted = insertedText(suggestion);
    if (inserted !== null) {
        edit.insert(uri, range.end, inserted);
    } else {
        edit.replace(uri, range, suggestion);
    }
}

/**
 * The core's `ignore` request for one diagnostic.
 *
 * It carries the full text and the original byte offsets, because the ignore
 * store keys on the fingerprint the core made when it reported the finding.
 */
export function ignoreRequest(diagnostic: ExtendedDiagnostic, document: vscode.TextDocument, text: string) {
    return {
        ignore: {
            message: diagnostic.message,
            context: document.getText(diagnostic.range),
            text,
            startByte: diagnostic.coreStartByte ?? 0,
            endByte: diagnostic.coreEndByte ?? 0,
        },
    };
}
