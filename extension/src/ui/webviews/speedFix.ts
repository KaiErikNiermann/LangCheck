/**
 * SpeedFix: a panel for going through a document's findings one at a time.
 */
import * as path from 'path';
import * as vscode from 'vscode';

import { COMMANDS, executeCommand } from '../../commands/ids';
import { getSetting } from '../../config/settings';
import { diagId, parseDiagId, ruleIdOf, type ExtendedDiagnostic, type DiagId } from '../../diagnostics/diagnostic';
import type { FixTarget } from '../../diagnostics/fixTarget';
import type { DiagnosticStore } from '../../diagnostics/store';
import { displayOriginalText, speedFixSuggestionLabel } from '../../shared/inlayLabels';
import { createBesidePanel, webviewHtml } from './html';
import type { SpeedFixDiagnostic, SpeedFixScope, WebviewToExtensionMessage } from './protocol';
import { uriKey } from '../../shared/documents';

/** What the panel's buttons do, which belongs to the diagnostic actions, not to the panel. */
export interface SpeedFixActions {
    applyFix(diagnosticId: DiagId, suggestion: string): Promise<void>;
    ignore(diagnosticId: DiagId): Promise<void>;
    check(document: vscode.TextDocument): Promise<number>;
}

export interface SpeedFixDeps {
    readonly context: vscode.ExtensionContext;
    readonly store: DiagnosticStore;
    readonly fixTarget: FixTarget;
    readonly actions: SpeedFixActions;
}

/** Build the SpeedFix webview payload for one diagnostic, precomputing the
 *  display labels so all formatting lives in `inlayLabels`. */
function toSpeedFixDiagnostic(
    d: ExtendedDiagnostic,
    index: number,
    document: vscode.TextDocument,
    fileName: string,
): SpeedFixDiagnostic {
    const text = document.getText(d.range);
    const suggestions = d.suggestions || [];
    return {
        id: diagId(index),
        message: d.message,
        suggestions,
        suggestionLabels: suggestions.map(s => speedFixSuggestionLabel(text, s)),
        text,
        displayText: displayOriginalText(text),
        context: document.lineAt(d.range.start.line).text.trim(),
        ruleId: ruleIdOf(d, 'unknown'),
        fileName,
        lineNumber: d.range.start.line + 1,
    };
}

export class SpeedFixPanel {
    private panel: vscode.WebviewPanel | null = null;
    /** File or workspace: whether finishing one document moves on to the next. */
    private scope: SpeedFixScope = 'file';

    constructor(private readonly deps: SpeedFixDeps) {}

    /** Show the panel, creating it on first use. */
    open(): void {
        // Capture the active editor before creating the panel, since the
        // webview will steal focus and make activeTextEditor undefined.
        const originEditor = vscode.window.activeTextEditor;

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.update();
            return;
        }

        this.panel = createBesidePanel(this.deps.context.extensionPath, 'speedFix', 'SpeedFix', ['dist', 'out']);

        this.panel.webview.html = webviewHtml(this.panel.webview, this.deps.context.extensionPath, { script: 'index', title: 'SpeedFix' });

        this.panel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
            switch (message.type) {
                case 'ready': {
                    const hpm = getSetting('performance.highPerformanceMode');
                    this.panel?.webview.postMessage({ type: 'setLowResource', payload: hpm });
                    this.panel?.webview.postMessage({ type: 'setScope', payload: this.scope });
                    // Track which file SpeedFix is targeting
                    const targetEditor = originEditor ?? vscode.window.activeTextEditor;
                    this.deps.fixTarget.uri = targetEditor ? uriKey(targetEditor.document.uri) : null;
                    // If we already have diagnostics, send them immediately
                    this.update();
                    // If no diagnostics exist yet, auto-run a check using the
                    // editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !this.deps.store.has(uriKey(editorForCheck.document.uri))) {
                        this.sendLoading(true);
                        this.deps.actions.check(editorForCheck.document).then(() => {
                            this.sendLoading(false);
                        });
                    }
                    break;
                }
                case 'applyFix':
                    await this.deps.actions.applyFix(message.payload.diagnosticId, message.payload.suggestion);
                    break;
                case 'ignore':
                    await this.deps.actions.ignore(message.payload.diagnosticId);
                    this.panel?.reveal(vscode.ViewColumn.Beside, false);
                    break;
                case 'addDictionary':
                    await executeCommand(COMMANDS.addToDictionary, message.payload.word);
                    this.panel?.reveal(vscode.ViewColumn.Beside, false);
                    break;
                case 'goToLocation': {
                    const editor = this.deps.fixTarget.findEditor();
                    if (!editor) break;
                    const diagnostics = this.deps.store.get(uriKey(editor.document.uri));
                    if (!diagnostics) break;
                    const idx = parseDiagId(message.payload.diagnosticId);
                    const diag = diagnostics[idx];
                    if (diag) {
                        editor.selection = new vscode.Selection(diag.range.start, diag.range.end);
                        editor.revealRange(diag.range, vscode.TextEditorRevealType.InCenter);
                    }
                    break;
                }
                case 'skip':
                case 'prev':
                case 'next':
                    // Navigation is handled client-side in the webview
                    break;
                case 'refresh': {
                    const editor = this.deps.fixTarget.findEditor() ?? vscode.window.activeTextEditor;
                    if (editor) {
                        this.sendLoading(true);
                        await this.deps.actions.check(editor.document);
                        this.sendLoading(false);
                    }
                    break;
                }
                case 'setScope':
                    this.scope = message.payload;
                    this.update();
                    break;
                case 'close':
                    this.panel?.dispose();
                    break;
            }
        }, undefined, this.deps.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.panel = null;
            this.deps.fixTarget.uri = null;
        }, null, this.deps.context.subscriptions);
    }

    sendLoading(loading: boolean): void {
        this.panel?.webview.postMessage({ type: 'loading', payload: loading });
    }

    /** Bring the panel back to the front without taking focus, so the user can carry on. */
    reveal(): void {
        this.panel?.reveal(vscode.ViewColumn.Beside, false);
    }

    update(): void {
        if (!this.panel) return;
        const editor = this.deps.fixTarget.findEditor() ?? vscode.window.activeTextEditor;

        if (editor) {
            const diagnostics = this.deps.store.get(uriKey(editor.document.uri));
            if (diagnostics && diagnostics.length > 0) {
                this.deps.fixTarget.uri = uriKey(editor.document.uri);
                const fileName = path.basename(editor.document.uri.fsPath);
                const payload: SpeedFixDiagnostic[] = diagnostics.map((d, i) =>
                    toSpeedFixDiagnostic(d, i, editor.document, fileName));
                this.panel.webview.postMessage({ type: 'setDiagnostics', payload });
                this.sendWorkspaceProgress();
                return;
            }
        }

        // Current file has no diagnostics — try workspace advance
        if (this.scope === 'workspace') {
            const currentUri = editor ? uriKey(editor.document.uri) : undefined;
            this.advance(currentUri);
            return;
        }

        this.panel.webview.postMessage({ type: 'setDiagnostics', payload: [] });
        this.sendWorkspaceProgress();
    }

    /** In workspace mode, find and open the next file that has diagnostics. */
    private async advance(currentUri?: string): Promise<void> {
        for (const [uriStr, diags] of this.deps.store) {
            if (uriStr === currentUri || diags.length === 0) continue;

            const uri = vscode.Uri.parse(uriStr);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
            this.deps.fixTarget.uri = uriStr;

            const fileName = path.basename(doc.uri.fsPath);
            const payload: SpeedFixDiagnostic[] = diags.map((d, i) =>
                toSpeedFixDiagnostic(d, i, doc, fileName));
            this.panel?.webview.postMessage({ type: 'setDiagnostics', payload });
            this.sendWorkspaceProgress();
            this.panel?.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        // No more files with diagnostics — all done across workspace
        this.panel?.webview.postMessage({ type: 'setDiagnostics', payload: [] });
        this.sendWorkspaceProgress();
    }

    private sendWorkspaceProgress(): void {
        if (!this.panel || this.scope !== 'workspace') return;
        let filesWithIssues = 0;
        for (const [, diags] of this.deps.store) {
            if (diags.length > 0) filesWithIssues++;
        }
        this.panel.webview.postMessage({
            type: 'setWorkspaceProgress',
            payload: { filesWithIssues },
        });
    }
}
