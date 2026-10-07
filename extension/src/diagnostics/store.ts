/**
 * The diagnostics on screen, kept twice on purpose.
 *
 * VS Code's `DiagnosticCollection` is what draws the squiggles, but it only
 * holds plain `vscode.Diagnostic`s. Every feature that acts on a finding
 * (quick fixes, hints, SpeedFix, the Inspector) needs the suggestions, byte
 * offsets and rule metadata the core sent, so the same list is kept here by
 * URI string alongside it. The two are always written together.
 */
import * as vscode from 'vscode';

import { uriKey, type UriKey } from '../shared/documents';
import { diagId, parseDiagId, type DiagId, type ExtendedDiagnostic } from './diagnostic';

/** A finding an action may act on: see {@link DiagnosticStore.resolve}. */
export interface ResolvedDiagnostic {
    readonly diagnostic: ExtendedDiagnostic;
    readonly index: number;
    /** The whole list it is in, for an optimistic removal. */
    readonly diagnostics: ExtendedDiagnostic[];
    /** That list's generation: an optimistic write replaces it only while it is still the store's ({@link DiagnosticStore.holds}). */
    readonly generation: number;
}

export class DiagnosticStore implements vscode.Disposable, Iterable<[UriKey, ExtendedDiagnostic[]]> {
    private readonly collection = vscode.languages.createDiagnosticCollection('language-check');
    private readonly byUri = new Map<UriKey, ExtendedDiagnostic[]>();
    private readonly listeners: (() => void)[] = [];
    /** Which list each document has now; bumped on every write, never reused. */
    private readonly generations = new Map<UriKey, number>();
    private lastGeneration = 0;
    /** The document version each document's list was checked at. */
    private readonly checkedVersions = new Map<UriKey, number>();

    has(uri: UriKey): boolean {
        return this.byUri.has(uri);
    }

    get(uri: UriKey): ExtendedDiagnostic[] | undefined {
        return this.byUri.get(uri);
    }

    [Symbol.iterator](): IterableIterator<[UriKey, ExtendedDiagnostic[]]> {
        return this.byUri.entries();
    }

    /**
     * Replace one document's diagnostics, without telling anyone.
     *
     * Callers that change several documents write each and {@link notify}
     * once. `documentUri` is passed rather than parsed from `uri`, because
     * each caller already holds the one it has always drawn with.
     *
     * `version`, when given, says the list describes the document at that
     * version: a list moved over the caller's own edit (rebase.ts). Without
     * it the list describes whatever the last check did.
     */
    write(uri: UriKey, documentUri: vscode.Uri, diagnostics: ExtendedDiagnostic[], version?: number): void {
        this.byUri.set(uri, diagnostics);
        this.generations.set(uri, ++this.lastGeneration);
        if (version !== undefined) this.checkedVersions.set(uri, version);
        this.collection.set(documentUri, diagnostics);
    }

    /**
     * {@link write} for a finished check of the text at `version`, which has
     * always drawn before it records. A write leaves the version as it was:
     * what it removes does not change what the rest describe.
     */
    publishCheck(documentUri: vscode.Uri, diagnostics: ExtendedDiagnostic[], version: number): void {
        // The store first, then the collection, as write() does: whatever the
        // collection notifies (a code-action request, the web's card) reads
        // the store and must find the findings it is being told about.
        const uri = uriKey(documentUri);
        this.byUri.set(uri, diagnostics);
        this.generations.set(uri, ++this.lastGeneration);
        this.checkedVersions.set(uri, version);
        this.collection.set(documentUri, diagnostics);
    }

    /** Whether `document`'s list was checked at its current text, so its ranges hold the text they were found at. */
    isCurrent(document: vscode.TextDocument): boolean {
        return this.checkedVersions.get(uriKey(document.uri)) === document.version;
    }

    /** The id the finding at `index` of `uri`'s current list goes by. */
    idOf(uri: UriKey, index: number): DiagId {
        return diagId(this.generations.get(uri) ?? 0, index);
    }

    /**
     * The finding `id` names in `document`, only if it is safe to act on:
     * the id is from the document's current list, and that list was checked
     * at the document's current text. Otherwise `undefined`, and the caller
     * re-checks rather than edit or ignore by a range that no longer holds
     * the text it was found at (two fixes in a row on one line, or an edit
     * typed since the check).
     */
    resolve(id: string, document: vscode.TextDocument): ResolvedDiagnostic | undefined {
        const uri = uriKey(document.uri);
        const parsed = parseDiagId(id);
        const diagnostics = this.byUri.get(uri);
        if (parsed === undefined || diagnostics === undefined) return undefined;
        if (parsed.generation !== this.generations.get(uri) || !this.isCurrent(document)) return undefined;
        const diagnostic = diagnostics[parsed.index];
        return diagnostic === undefined ? undefined : { diagnostic, index: parsed.index, diagnostics, generation: parsed.generation };
    }

    /** Which list `uri` has now, for {@link holds} after an await. */
    generationOf(uri: UriKey): number {
        return this.generations.get(uri) ?? 0;
    }

    /**
     * Whether `uri`'s list is still the one of `generation`. An action that
     * awaited (a fix, an ignore) asks before writing the list it computed
     * from: a check that landed meanwhile replaced it, and the action's list
     * would put back what that check took out.
     */
    holds(uri: UriKey, generation: number): boolean {
        return this.generations.get(uri) === generation;
    }

    /**
     * Forget one document altogether, when it is closed for good (the
     * browser extension's documents are gone once the page moves on):
     * nothing kept for it, here or drawn, and its ids resolve to nothing.
     */
    forget(uri: UriKey, documentUri: vscode.Uri): void {
        this.byUri.delete(uri);
        this.generations.delete(uri);
        this.checkedVersions.delete(uri);
        this.collection.delete(documentUri);
    }

    /** Drop everything, silently: used before a full re-check that will publish afresh. */
    clear(): void {
        this.collection.clear();
        this.byUri.clear();
        this.generations.clear();
        this.checkedVersions.clear();
    }

    /**
     * Run `listener` on every {@link notify}, after the ones registered before it.
     *
     * A plain list rather than a `vscode.EventEmitter`: an emitter catches what
     * a listener throws, and an exception here has always propagated to the
     * caller, which is what a check relies on to abandon a half-applied result.
     */
    onChange(listener: () => void): void {
        this.listeners.push(listener);
    }

    notify(): void {
        for (const listener of this.listeners) listener();
    }

    dispose(): void {
        this.collection.dispose();
    }
}

/**
 * What the user just silenced, applied to checks that were already running.
 *
 * Adding a word or deactivating a rule reaches the core at once, but a check
 * started a moment earlier still answers with the old findings. These sets
 * filter those answers until the re-check that follows has landed.
 */
export class Suppression {
    readonly words = new Set<string>();
    readonly rules = new Set<string>();
}
