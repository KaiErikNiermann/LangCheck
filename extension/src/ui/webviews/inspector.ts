/**
 * The Inspector: a panel showing what the core extracted from a document, how
 * long each stage took, and how the engines are doing.
 */
import * as path from 'path';
import * as vscode from 'vscode';

import type { CheckResults } from '../../checking/results';
import { COMMANDS, executeCommand } from '../../commands/ids';
import { hasDockerCompose } from '../../core/languagetool';
import { ruleIdOf } from '../../diagnostics/diagnostic';
import type { FixTarget } from '../../diagnostics/fixTarget';
import type { DiagnosticStore } from '../../diagnostics/store';
import { byteToCharConverter } from '../../checking/offsets';
import { GITHUB_REPO } from '../../shared/links';
import type { InspectorLog } from '../inspectorLog';
import { detectEngineInfo } from '../../core/engineInfo';
import { createBesidePanel, webviewHtml } from './html';
import type { InspectorDiagnosticSummary, InspectorToExtensionMessage } from './protocol';
import { uriKey, type UriKey } from '../../shared/documents';

export interface InspectorDeps {
    readonly context: vscode.ExtensionContext;
    readonly store: DiagnosticStore;
    readonly results: CheckResults;
    readonly fixTarget: FixTarget;
    readonly inspectorLog: InspectorLog;
    readonly check: (document: vscode.TextDocument) => Promise<number>;
}

export class InspectorPanel {
    private panel: vscode.WebviewPanel | null = null;
    /** The document the panel last described, which its buttons act on. */
    private inspected: UriKey | undefined;

    constructor(private readonly deps: InspectorDeps) {}

    /**
     * The editor showing the document on display, for the panel's buttons.
     *
     * Not `activeTextEditor`: clicking in the panel moves focus into the
     * webview, and VS Code then reports no active text editor at all.
     */
    private inspectedEditor(): vscode.TextEditor | undefined {
        return vscode.window.visibleTextEditors.find(e => uriKey(e.document.uri) === this.inspected)
            ?? vscode.window.activeTextEditor;
    }

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

        this.panel = createBesidePanel(this.deps.context.extensionPath, 'inspector', 'Inspector', ['dist']);

        this.deps.inspectorLog.attach(this.panel.webview);
        this.panel.webview.html = webviewHtml(this.panel.webview, this.deps.context.extensionPath, { script: 'inspector', title: 'Inspector' });

        this.panel.webview.onDidReceiveMessage(async (message: InspectorToExtensionMessage) => {
            switch (message.type) {
                case 'inspectorReady': {
                    // Use the editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !this.deps.store.has(uriKey(editorForCheck.document.uri))) {
                        await this.deps.check(editorForCheck.document);
                    }
                    await this.update();
                    this.panel?.webview.postMessage({ type: 'setDockerAvailable', payload: hasDockerCompose() });
                    const extVersion = (this.deps.context.extension.packageJSON as { version?: string }).version ?? 'unknown';
                    this.panel?.webview.postMessage({ type: 'setExtensionVersion', payload: extVersion });
                    break;
                }
                case 'highlightRange': {
                    // The click that sent this put focus in the webview, so
                    // there is no active text editor to select in.
                    const editor = this.inspectedEditor();
                    if (editor) {
                        const byteToChar = byteToCharConverter(editor.document.getText());
                        const start = editor.document.positionAt(byteToChar(message.payload.startByte));
                        const end = editor.document.positionAt(byteToChar(message.payload.endByte));
                        await vscode.window.showTextDocument(editor.document, {
                            ...(editor.viewColumn === undefined ? {} : { viewColumn: editor.viewColumn }),
                            selection: new vscode.Selection(start, end),
                        });
                    }
                    break;
                }
                case 'healthCheckLT': {
                    const editor = this.inspectedEditor();
                    if (editor) {
                        await this.deps.check(editor.document);
                    }
                    break;
                }
                case 'restartLTDocker': {
                    executeCommand(COMMANDS.restartLTDocker);
                    break;
                }
                case 'openIssue': {
                    const confirm = await vscode.window.showWarningMessage(
                        vscode.l10n.t('The report includes file names, diagnostics, and timing data (not document text). This will be publicly visible on GitHub. Continue?'),
                        { modal: true },
                        vscode.l10n.t('Open Issue')
                    );
                    if (!confirm) break;
                    const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new`;
                    const title = encodeURIComponent('Inspector bug report');
                    const encodedBody = encodeURIComponent(message.payload.body);
                    const fullUrl = `${issueUrl}?title=${title}&body=${encodedBody}`;
                    if (fullUrl.length < 6000) {
                        vscode.env.openExternal(vscode.Uri.parse(fullUrl));
                    } else {
                        await vscode.env.clipboard.writeText(message.payload.body);
                        vscode.env.openExternal(vscode.Uri.parse(issueUrl));
                        vscode.window.showInformationMessage(
                            vscode.l10n.t('Report copied to clipboard — paste it in the issue body.')
                        );
                    }
                    break;
                }
                case 'copyReport': {
                    await vscode.env.clipboard.writeText(message.payload.body);
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Report copied to clipboard.')
                    );
                    break;
                }
            }
        }, undefined, this.deps.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.panel = null;
            this.deps.inspectorLog.detach();
        }, null, this.deps.context.subscriptions);
    }

    async update(): Promise<void> {
        if (!this.panel) return;

        // Prefer active editor, fall back to a visible editor with diagnostics.
        // When the inspector panel has focus, activeTextEditor is undefined.
        const editor = vscode.window.activeTextEditor
            ?? this.deps.fixTarget.findEditor()
            ?? vscode.window.visibleTextEditors[0];
        if (!editor) return;

        const document = editor.document;
        const uri = uriKey(document.uri);
        this.inspected = uri;
        const fileName = path.basename(document.uri.fsPath);

        // Send real extraction data from cache.
        //
        // Everything here comes from one CheckProse response, so the syntax and the
        // per-range language always describe the boxes shown beside them. When the
        // cache has been dropped — a config change invalidates it — there is
        // nothing to show until the re-check lands, which is the point: a language
        // from the previous config is worse than an empty panel.
        const cached = this.deps.results.extraction.get(uri);
        this.panel.webview.postMessage({
            type: 'setExtraction',
            payload: {
                prose: cached?.prose ?? [],
                fileName,
                languageId: cached?.languageId ?? document.languageId,
                syntax: cached?.syntax ?? '',
                maxRangeBytes: cached?.maxRangeBytes ?? 0,
            },
        });

        // Send words the name filter silenced
        this.panel.webview.postMessage({
            type: 'setNames',
            payload: { names: this.deps.results.names.get(uri) ?? [] },
        });

        // Send real benchmark timings if available
        if (this.deps.results.timings.length > 0) {
            this.panel.webview.postMessage({
                type: 'setLatency',
                payload: { stages: this.deps.results.timings },
            });
        }

        // Send check info if available
        if (this.deps.results.info) {
            this.panel.webview.postMessage({
                type: 'setCheckInfo',
                payload: this.deps.results.info,
            });
        }

        // Send diagnostic summary
        const diags = this.deps.store.get(uri);
        if (diags && diags.length > 0) {
            const byRule = new Map<string, number>();
            const bySeverity = new Map<string, number>();
            for (const d of diags) {
                const rule = ruleIdOf(d, 'unknown');
                byRule.set(rule, (byRule.get(rule) || 0) + 1);
                const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                            d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' :
                            d.severity === vscode.DiagnosticSeverity.Hint ? 'hint' : 'info';
                bySeverity.set(sev, (bySeverity.get(sev) || 0) + 1);
            }
            const summary: InspectorDiagnosticSummary = {
                total: diags.length,
                byRule: [...byRule.entries()]
                    .map(([ruleId, count]) => ({ ruleId, count }))
                    .sort((a, b) => b.count - a.count),
                bySeverity: [...bySeverity.entries()]
                    .map(([severity, count]) => ({ severity, count })),
            };
            this.panel.webview.postMessage({
                type: 'setDiagnosticSummary',
                payload: summary,
            });
        }

        // Send engine health state
        if (this.deps.results.engineHealth.length > 0) {
            this.panel.webview.postMessage({
                type: 'setEngineHealth',
                payload: this.deps.results.engineHealth,
            });
        }

        // Send engine info (binary detection, config paths)
        const engineInfo = await detectEngineInfo();
        this.panel.webview.postMessage({
            type: 'setEngineInfo',
            payload: engineInfo,
        });
    }

    /** A check finished: show its stage timings and summary, if open. */
    checkRecorded(timings: { name: string; durationMs: number }[]): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'setLatency',
                payload: { stages: timings },
            });
            this.panel.webview.postMessage({
                type: 'setCheckInfo',
                payload: this.deps.results.info,
            });
        }
    }

    /** The core reported engine health: show it, if open. */
    healthUpdated(): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'setEngineHealth',
                payload: this.deps.results.engineHealth,
            });
        }
    }
}
