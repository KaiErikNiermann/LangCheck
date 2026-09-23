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

import type { ExtendedDiagnostic } from './diagnostic';

export class DiagnosticStore implements vscode.Disposable, Iterable<[string, ExtendedDiagnostic[]]> {
    private readonly collection = vscode.languages.createDiagnosticCollection('language-check');
    private readonly byUri = new Map<string, ExtendedDiagnostic[]>();
    private readonly listeners: (() => void)[] = [];

    has(uri: string): boolean {
        return this.byUri.has(uri);
    }

    get(uri: string): ExtendedDiagnostic[] | undefined {
        return this.byUri.get(uri);
    }

    [Symbol.iterator](): IterableIterator<[string, ExtendedDiagnostic[]]> {
        return this.byUri.entries();
    }

    /**
     * Replace one document's diagnostics, without telling anyone.
     *
     * Callers that change several documents write each and {@link notify}
     * once. `documentUri` is passed rather than parsed from `uri`, because
     * each caller already holds the one it has always drawn with.
     */
    write(uri: string, documentUri: vscode.Uri, diagnostics: ExtendedDiagnostic[]): void {
        this.byUri.set(uri, diagnostics);
        this.collection.set(documentUri, diagnostics);
    }

    /** {@link write} for a finished check, which has always drawn before it records. */
    publishCheck(documentUri: vscode.Uri, diagnostics: ExtendedDiagnostic[]): void {
        this.collection.set(documentUri, diagnostics);
        this.byUri.set(documentUri.toString(), diagnostics);
    }

    /** Drop everything, silently: used before a full re-check that will publish afresh. */
    clear(): void {
        this.collection.clear();
        this.byUri.clear();
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
