/**
 * Acting on findings: applying a suggestion or ignoring one by its id, and
 * replacing a misspelled word everywhere it was found.
 *
 * Both edit what is on screen at once and re-check in the background, so the
 * user is not left waiting on the core for a change they already made.
 */
import * as vscode from 'vscode';

import type { Checker } from '../checking/checker';
import type { CoreHandle } from '../core/transport';
import type { Logger } from '../shared/logger';
import type { InspectorLog } from '../ui/inspectorLog';
import type { SpeedFixPanel } from '../ui/webviews/speedFix';
import { coreByte } from '../checking/offsets';
import { addSuggestionEdit, ignoreRequest, insertedText, isSpellingOf, type DiagId, type ExtendedDiagnostic } from './diagnostic';
import { byteDelta, rebaseSpan, type Span, type TextChange } from './rebase';
import type { FixTarget } from './fixTarget';
import type { DiagnosticStore } from './store';
import { findOpenDocument, uriKey, type UriKey } from '../shared/documents';

export interface DiagnosticActionDeps {
    readonly core: CoreHandle;
    readonly checker: Checker;
    readonly log: Pick<Logger, 'debug'>;
    readonly inspectorLog: InspectorLog;
    readonly store: DiagnosticStore;
    readonly fixTarget: FixTarget;
    readonly speedFix: Pick<SpeedFixPanel, 'sendLoading' | 'reveal'>;
}

/** The edit applying `suggestion` to `diagnostic` makes, in offsets of the text before it (as addSuggestionEdit builds it). */
function suggestionChange(document: vscode.TextDocument, diagnostic: ExtendedDiagnostic, suggestion: string): TextChange {
    const inserted = insertedText(suggestion);
    if (inserted !== null) {
        const at = document.offsetAt(diagnostic.range.end);
        return { start: at, end: at, text: inserted };
    }
    return { start: document.offsetAt(diagnostic.range.start), end: document.offsetAt(diagnostic.range.end), text: suggestion };
}

/**
 * Findings moved over `change`: `spans` are their offsets in `before` (the
 * text the change was made to), the new ranges are in `document`, which
 * holds the text after it. The core's byte offsets shift with a finding
 * that moved, since the ignore fingerprint is taken at them. A finding the
 * change touched is dropped.
 */
function rebaseOver(
    diagnostics: readonly ExtendedDiagnostic[],
    spans: readonly Span[],
    before: string,
    change: TextChange,
    document: vscode.TextDocument,
): ExtendedDiagnostic[] {
    const bytes = byteDelta(before, change);
    return diagnostics.flatMap((d, i) => {
        const span = spans[i];
        const moved = span === undefined ? undefined : rebaseSpan(span, change);
        if (moved === undefined) return [];
        const copy = Object.assign(Object.create(Object.getPrototypeOf(d) as object) as ExtendedDiagnostic, d);
        copy.range = new vscode.Range(document.positionAt(moved.start), document.positionAt(moved.end));
        if (moved !== span && d.coreStartByte !== undefined && d.coreEndByte !== undefined) {
            copy.coreStartByte = coreByte(d.coreStartByte + bytes);
            copy.coreEndByte = coreByte(d.coreEndByte + bytes);
        }
        return [copy];
    });
}

export class DiagnosticActions {
    /** The action running now: each starts when the one before has finished. */
    private running: Promise<void> = Promise.resolve();

    constructor(private readonly deps: DiagnosticActionDeps) {}

    /**
     * Runs `action` after every action started before it. Two keys pressed
     * in a row in SpeedFix are two calls: the second must resolve its finding
     * after the first has edited the text, not edit by a range the first
     * moved.
     */
    private oneAtATime(action: () => Promise<void>): Promise<void> {
        const next = this.running.then(action);
        this.running = next.catch(() => {});
        return next;
    }

    applyFix(diagnosticId: DiagId, suggestion: string): Promise<void> {
        return this.oneAtATime(() => this.applyFixNow(diagnosticId, suggestion));
    }

    ignore(diagnosticId: DiagId): Promise<void> {
        return this.oneAtATime(() => this.ignoreNow(diagnosticId));
    }

    /**
     * Replaces `word` with `replacement` wherever it was found misspelled:
     * in the document `only`, or in every open document.
     */
    fixAllSpelling(word: string, replacement: string, only?: UriKey): Promise<void> {
        return this.oneAtATime(() => this.fixAllSpellingNow(word, replacement, only));
    }

    /**
     * One edit over every document, all or nothing. A document whose
     * findings were checked against older text is left out and re-checked:
     * its ranges would replace whatever moved under them. Findings are
     * removed only once the edit applied, and only from the lists it was
     * made from (a check that landed meanwhile knows better).
     */
    private async fixAllSpellingNow(word: string, replacement: string, only: UriKey | undefined): Promise<void> {
        const { checker, inspectorLog, store } = this.deps;
        const edit = new vscode.WorkspaceEdit();
        const planned: { uri: UriKey; document: vscode.TextDocument; generation: number; remaining: ExtendedDiagnostic[] }[] = [];
        const stale: vscode.TextDocument[] = [];
        for (const [uri, diagnostics] of store) {
            const document = only === undefined || uri === only ? findOpenDocument(uri) : undefined;
            if (!document) continue;
            if (!store.isCurrent(document)) {
                stale.push(document);
                continue;
            }
            const matching = diagnostics.filter((d) => isSpellingOf(document, d, word));
            if (matching.length === 0) continue;
            // Two engines can flag the same word: one replacement per span,
            // since two over one span overlap and refuse the whole edit.
            const spans = new Set<string>();
            for (const d of matching) {
                const span = `${String(document.offsetAt(d.range.start))}:${String(document.offsetAt(d.range.end))}`;
                if (spans.has(span)) continue;
                spans.add(span);
                edit.replace(document.uri, d.range, replacement);
            }
            planned.push({ uri, document, generation: store.generationOf(uri), remaining: diagnostics.filter((d) => !matching.includes(d)) });
        }
        if (stale.length > 0) inspectorLog.push('info', 'fixAllSpelling', `${String(stale.length)} document(s) changed since their check: re-checking them instead`);
        for (const document of stale) void checker.check(document);
        if (planned.length === 0) return;

        if (await vscode.workspace.applyEdit(edit)) {
            for (const { uri, document, generation, remaining } of planned) {
                if (store.holds(uri, generation)) store.write(uri, document.uri, remaining);
            }
            store.notify();
        } else {
            inspectorLog.push('info', 'fixAllSpelling', 'The text changed under the edit: nothing replaced, re-checking');
        }
        for (const { document } of planned) await checker.check(document);
    }

    private async applyFixNow(diagnosticId: DiagId, suggestion: string): Promise<void> {
        const { checker, log, inspectorLog, store, fixTarget, speedFix } = this.deps;
        const editor = fixTarget.findEditor();
        if (!editor) return;

        const uri = editor.document.uri;
        const uriStr = uriKey(uri);
        const found = this.resolve(diagnosticId, editor.document, 'applyFix');
        if (!found) return;
        const { diagnostic, index, diagnostics, generation } = found;

        const t0 = performance.now();
        const origText = editor.document.getText(diagnostic.range);
        log.debug('applyFix', { diagnosticId, suggestion, original: origText });
        inspectorLog.push('info', 'applyFix', `"${origText}" → "${suggestion}"`);
        speedFix.sendLoading(true);

        try {
            // Apply the fix directly — we are our own code action provider.
            // Handle "Insert" suggestions: `Insert ","` means insert the quoted text
            // at the diagnostic position, not replace the diagnostic range with the
            // literal string `Insert ","`.
            const document = editor.document;
            const before = { text: document.getText(), version: document.version };
            const change = suggestionChange(document, diagnostic, suggestion);
            const others = diagnostics.filter((_, i) => i !== index);
            const spans = others.map((d) => ({ start: document.offsetAt(d.range.start), end: document.offsetAt(d.range.end) }));
            const edit = new vscode.WorkspaceEdit();
            addSuggestionEdit(edit, uri, diagnostic.range, suggestion);
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                void checker.check(document);
                return;
            }

            // Optimistic removal: remove the fixed diagnostic immediately.
            // When this edit is the only change since, the rest move over it
            // and stay actionable (a second fix on the line works at once);
            // otherwise they wait for the re-check (DiagnosticStore.resolve).
            // Only over the list this started from: a check that landed during
            // the edit has the newer one, and the re-check below follows it.
            if (store.holds(uriStr, generation)) {
                if (document.version === before.version + 1) {
                    store.write(uriStr, uri, rebaseOver(others, spans, before.text, change, document), document.version);
                } else {
                    store.write(uriStr, uri, others);
                }
                store.notify();
            }

            // Background re-check for full consistency
            inspectorLog.push('debug', 'applyFix', 'Re-checking after fix', { durationMs: performance.now() - t0 });
            checker.check(editor.document);
        } finally {
            speedFix.sendLoading(false);
            // Refocus the SpeedFix panel so the user can continue through issues
            speedFix.reveal();
        }
    }

    private async ignoreNow(diagnosticId: DiagId): Promise<void> {
        const { core, checker, inspectorLog, store, fixTarget, speedFix } = this.deps;
        const editor = fixTarget.findEditor();
        if (!editor || !core.client) return;

        const uri = uriKey(editor.document.uri);
        const found = this.resolve(diagnosticId, editor.document, 'ignoreDiagnostic');
        if (found) {
            const { diagnostic, index, diagnostics, generation } = found;
            speedFix.sendLoading(true);
            const t0 = performance.now();
            const ignoredText = editor.document.getText(diagnostic.range);
            inspectorLog.push('info', 'ignoreDiagnostic', `Ignoring "${ignoredText}" (${diagnostic.message})`);
            // Send ignore request to core with full document text + original byte
            // offsets so the fingerprint matches the one created during checkProse.
            await core.client.sendRequest(ignoreRequest(diagnostic, editor.document, editor.document.getText()));

            // Optimistic removal: remove the ignored diagnostic immediately,
            // over the list this started from only (see applyFixNow).
            if (store.holds(uri, generation)) {
                store.write(uri, editor.document.uri, diagnostics.filter((_, i) => i !== index));
                store.notify();
            }
            speedFix.sendLoading(false);
            inspectorLog.push('info', 'ignoreDiagnostic', 'Ignore confirmed, re-checking', { durationMs: performance.now() - t0 });

            // Background re-check for full consistency
            checker.check(editor.document);
        }
    }

    /**
     * The finding `diagnosticId` names, if it can still be acted on (see
     * DiagnosticStore.resolve). When it cannot -- the id is from a list
     * replaced since, or the text changed since the check -- nothing is
     * done to the document and it is re-checked, which hands the panel and
     * the hints ids that are current.
     */
    private resolve(diagnosticId: DiagId, document: vscode.TextDocument, source: string) {
        const found = this.deps.store.resolve(diagnosticId, document);
        if (!found) {
            this.deps.inspectorLog.push('info', source, 'The finding is out of date: re-checking instead');
            void this.deps.checker.check(document);
        }
        return found;
    }
}
