/**
 * When a document gets checked: on open, on a tab switch, on edit or save,
 * and once the core is up for whatever was already on screen.
 */
import * as vscode from 'vscode';

import type { CoreService } from '../core/coreService';
import { getSetting } from '../config/settings';
import type { WorkspaceConfigState } from '../config/state';
import type { DiagnosticStore } from '../diagnostics/store';
import type { InspectorPanel } from '../ui/webviews/inspector';
import type { Checker } from './checker';
import { SUPPORTED_LANGUAGES, isCheckableIn } from './languages';
import { Debouncer } from './scheduler';
import { uriKey } from '../shared/documents';

export interface TriggerDeps {
    readonly core: CoreService;
    readonly store: DiagnosticStore;
    readonly checker: Checker;
    readonly configState: WorkspaceConfigState;
    readonly inspector: InspectorPanel;
}

export class CheckTriggers {
    /** Check-on-change debounce timer per document. */
    readonly debouncer = new Debouncer();

    constructor(private readonly deps: TriggerDeps) {}

    /** Whether this extension should check a document; see {@link isCheckableIn}. */
    isCheckable(document: vscode.TextDocument): boolean {
        return isCheckableIn(document, this.deps.core.schemaExtensions);
    }

    /**
     * When a document is re-checked after its first check.
     *
     * The fallback matters: every reader used to pass `'onChange'` while
     * package.json declares `'onSave'`, and the manifest wins, so the code
     * said one thing and the extension did the other.
     */
    private checkTrigger() {
        return getSetting('check.trigger');
    }

    /**
     * Check a document that has never been checked.
     *
     * Deliberately not gated on `check.trigger`. That setting is about when to
     * re-check -- on every keystroke or on save -- and reading it as "never
     * check until saved" left a freshly opened file with no squiggles at all
     * until the user edited and saved it. Opening the Inspector called
     * `checkDocument` directly, with no such gate, which is why the squiggles
     * turned up the moment the Inspector was opened and not before.
     */
    checkIfUnchecked(document: vscode.TextDocument): void {
        // Not a started client: a check sent between the process starting and
        // Initialize returning is answered with an empty dictionary. The
        // documents skipped here are picked up by `checkVisibleUnchecked` as
        // soon as Initialize returns.
        if (!this.deps.core.ready()) return;
        if (!this.isCheckable(document)) return;
        if (this.deps.store.has(uriKey(document.uri))) return;
        this.deps.checker.check(document);
    }

    /**
     * Check everything visible that has no diagnostics yet.
     *
     * Called once the core is up. The open and tab-switch handlers both return
     * early when `client` is still null, and a document that arrived during
     * startup was dropped with nothing to retry it -- the sole fallback was a
     * 500 ms timer, which loses whenever the binary takes longer than that to
     * start. Driving the retry off the core being ready removes the guess.
     */
    checkVisibleUnchecked(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.checkIfUnchecked(editor.document);
        }
    }

    /** Register the listeners, in this order, and check what is already on screen. */
    register(subscriptions: vscode.Disposable[]): void {
        // ── Auto-check on document open ──
        // Guard: only check documents visible in an editor tab.
        // VS Code fires onDidOpenTextDocument for background loads (search, git, etc.)
        // which would flood the server with hundreds of concurrent checks.
        subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
            if (!this.isCheckable(document)) return;
            const isVisible = vscode.window.visibleTextEditors.some(
                e => uriKey(e.document.uri) === uriKey(document.uri)
            );
            if (!isVisible) return;
            this.checkIfUnchecked(document);
        }));

        // Also check when the active editor changes (e.g. switching tabs)
        subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) return;
            this.checkIfUnchecked(editor.document);
        }));

        // ── Initial check on reload ──
        // An editor open before the extension activated raises no open event, so
        // it is checked here. `core.boot()` does the same once the core is ready;
        // whichever runs second finds the document already in the store and
        // does nothing, so the two cannot double-check it.
        this.checkVisibleUnchecked();

        // ── Check-on-change with debounce ──
        subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
            if (!this.isCheckable(event.document)) return;
            const trigger = this.checkTrigger();
            if (trigger !== 'onChange') return;

            const doc = event.document;
            this.debouncer.schedule(uriKey(doc.uri), this.deps.configState.debounceMs, () => {
                this.deps.checker.check(doc);
            });
        }));

        // Always re-check on save (regardless of trigger mode)
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (SUPPORTED_LANGUAGES.includes(document.languageId)) {
                // Cancel any pending debounce for this doc since we're checking now
                this.debouncer.cancel(uriKey(document.uri));
                await this.deps.checker.check(document);
                await this.deps.inspector.update();
            }
        });
    }
}
