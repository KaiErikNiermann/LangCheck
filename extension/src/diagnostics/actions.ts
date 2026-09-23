/**
 * Acting on one finding by its id: applying a suggestion, or ignoring it.
 *
 * Both edit what is on screen at once and re-check in the background, so the
 * user is not left waiting on the core for a change they already made.
 */
import * as vscode from 'vscode';

import type { Checker } from '../checking/checker';
import type { CoreService } from '../core/coreService';
import type { Logger } from '../shared/logger';
import type { InspectorLog } from '../ui/inspectorLog';
import type { SpeedFixPanel } from '../ui/webviews/speedFix';
import { addSuggestionEdit, ignoreRequest, parseDiagId } from './diagnostic';
import type { FixTarget } from './fixTarget';
import type { DiagnosticStore } from './store';
import { uriKey } from '../shared/documents';

export interface DiagnosticActionDeps {
    readonly core: CoreService;
    readonly checker: Checker;
    readonly log: Logger;
    readonly inspectorLog: InspectorLog;
    readonly store: DiagnosticStore;
    readonly fixTarget: FixTarget;
    readonly speedFix: SpeedFixPanel;
}

export class DiagnosticActions {
    constructor(private readonly deps: DiagnosticActionDeps) {}

    async applyFix(diagnosticId: string, suggestion: string): Promise<void> {
        const { checker, log, inspectorLog, store, fixTarget, speedFix } = this.deps;
        const editor = fixTarget.findEditor();
        if (!editor) return;

        const uri = editor.document.uri;
        const uriStr = uriKey(uri);
        const diagnostics = store.get(uriStr);
        if (!diagnostics) return;

        const index = parseDiagId(diagnosticId);
        const diagnostic = diagnostics[index];
        if (!diagnostic) return;

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
            const edit = new vscode.WorkspaceEdit();
            addSuggestionEdit(edit, uri, diagnostic.range, suggestion);
            await vscode.workspace.applyEdit(edit);

            // Optimistic removal: remove the fixed diagnostic immediately
            const remaining = diagnostics.filter((_, i) => i !== index);
            store.write(uriStr, uri, remaining);
            store.notify();

            // Background re-check for full consistency
            inspectorLog.push('debug', 'applyFix', 'Re-checking after fix', { durationMs: performance.now() - t0 });
            checker.check(editor.document);
        } finally {
            speedFix.sendLoading(false);
            // Refocus the SpeedFix panel so the user can continue through issues
            speedFix.reveal();
        }
    }

    async ignore(diagnosticId: string): Promise<void> {
        const { core, checker, inspectorLog, store, fixTarget, speedFix } = this.deps;
        const editor = fixTarget.findEditor();
        if (!editor || !core.client) return;

        const uri = uriKey(editor.document.uri);
        const diagnostics = store.get(uri);
        if (!diagnostics) return;

        const index = parseDiagId(diagnosticId);
        const diagnostic = diagnostics[index];
        if (diagnostic) {
            speedFix.sendLoading(true);
            const t0 = performance.now();
            const ignoredText = editor.document.getText(diagnostic.range);
            inspectorLog.push('info', 'ignoreDiagnostic', `Ignoring "${ignoredText}" (${diagnostic.message})`);
            // Send ignore request to core with full document text + original byte
            // offsets so the fingerprint matches the one created during checkProse.
            await core.client.sendRequest(ignoreRequest(diagnostic, editor.document, editor.document.getText()));

            // Optimistic removal: remove the ignored diagnostic immediately
            const remaining = diagnostics.filter((_, i) => i !== index);
            store.write(uri, editor.document.uri, remaining);
            store.notify();
            speedFix.sendLoading(false);
            inspectorLog.push('info', 'ignoreDiagnostic', 'Ignore confirmed, re-checking', { durationMs: performance.now() - t0 });

            // Background re-check for full consistency
            checker.check(editor.document);
        }
    }
}
