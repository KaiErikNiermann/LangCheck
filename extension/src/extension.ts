import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from './client';
import { languagecheck } from './proto/checker';
import { TraceLogger } from './trace';
import { createAPI } from './api';
import type { LanguageCheckDiagnostic } from './api';
import type { SpeedFixDiagnostic, WebviewToExtensionMessage } from './events';

let client: LanguageClient | null = null;
let traceLogger: TraceLogger | null = null;
const diagnosticCollection = vscode.languages.createDiagnosticCollection('language-check');
let speedFixPanel: vscode.WebviewPanel | null = null;
let languageStatusBarItem: vscode.StatusBarItem;
let insightsStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Language Check extension activated');

    const binaryPath = context.extensionMode === vscode.ExtensionMode.Development
        ? path.join(context.extensionPath, '..', 'rust-core', 'target', 'debug', 'language-check-server')
        : path.join(context.extensionPath, 'bin', 'language-check-server');

    traceLogger = new TraceLogger();
    context.subscriptions.push({ dispose: () => traceLogger?.dispose() });

    client = new LanguageClient(binaryPath);
    client.setTraceLogger(traceLogger);
    client.start();

    const initializeClient = () => {
        if (client && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            client.sendRequest({
                initialize: {
                    workspaceRoot: vscode.workspace.workspaceFolders[0]!.uri.fsPath
                }
            });
        }
    };

    // Initialize with workspace root
    initializeClient();

    // Re-initialize after auto-restart
    client.onRestart(() => {
        initializeClient();
    });

    // Status bar: spell-check language
    languageStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    languageStatusBarItem.command = 'language-check.selectLanguage';
    languageStatusBarItem.text = '$(book) EN-US';
    languageStatusBarItem.tooltip = 'Language Check: Click to change language';
    languageStatusBarItem.show();
    context.subscriptions.push(languageStatusBarItem);

    // Status bar: prose insights (word count, reading level)
    insightsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    insightsStatusBarItem.tooltip = 'Language Check: Prose Insights';
    insightsStatusBarItem.show();
    context.subscriptions.push(insightsStatusBarItem);

    // Update insights when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateInsightsStatusBar));

    const supportedLanguages = ['markdown', 'html', 'latex'];

    // Register Inlay Hints Provider
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguages.map(lang => ({ language: lang })),
        {
            provideInlayHints(document, _range, _token) {
                const diagnostics = diagnosticsMap.get(document.uri.toString());
                if (!diagnostics) return [];

                const hints: vscode.InlayHint[] = [];
                for (const d of diagnostics) {
                    if (d.confidence && d.confidence >= 0.8 && d.suggestions && d.suggestions.length > 0) {
                        const hint = new vscode.InlayHint(
                            d.range.end,
                            [
                                {
                                    value: ` → ${d.suggestions[0]}`,
                                    command: {
                                        command: 'language-check.applyFix',
                                        title: 'Apply Fix',
                                        arguments: [`diag-${diagnostics.indexOf(d)}`, d.suggestions[0]]
                                    }
                                }
                            ],
                            vscode.InlayHintKind.Type
                        );
                        hint.tooltip = `Accept suggestion: ${d.suggestions[0]}`;
                        hints.push(hint);
                    }
                }
                return hints;
            }
        }
    ));

    // Register Inline Completion Provider (ghost text suggestions)
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
        supportedLanguages.map(lang => ({ language: lang })),
        {
            provideInlineCompletionItems(document, position, _context, _token) {
                const diagnostics = diagnosticsMap.get(document.uri.toString());
                if (!diagnostics) return [];

                const items: vscode.InlineCompletionItem[] = [];
                for (const d of diagnostics) {
                    if (!d.suggestions || d.suggestions.length === 0) continue;
                    if (!d.range.contains(position)) continue;

                    const suggestion = d.suggestions[0];
                    if (!suggestion) continue;

                    items.push(new vscode.InlineCompletionItem(
                        suggestion,
                        d.range
                    ));
                }
                return items;
            }
        }
    ));

    // Register Code Action Provider (quickfix lightbulb)
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
        supportedLanguages.map(lang => ({ language: lang })),
        {
            provideCodeActions(document, range, context) {
                const diagnostics = diagnosticsMap.get(document.uri.toString());
                if (!diagnostics) return [];

                const actions: vscode.CodeAction[] = [];
                const relevantDiags = context.diagnostics.filter(
                    d => d.source === 'language-check'
                );

                for (const diag of relevantDiags) {
                    const extDiag = diagnostics.find(
                        ed => ed.range.isEqual(diag.range) && ed.message === diag.message
                    );
                    if (!extDiag) continue;
                    const diagIndex = diagnostics.indexOf(extDiag);

                    // Add a quickfix for each suggestion
                    if (extDiag.suggestions) {
                        for (const suggestion of extDiag.suggestions) {
                            const fix = new vscode.CodeAction(
                                `Fix: "${suggestion}"`,
                                vscode.CodeActionKind.QuickFix
                            );
                            fix.edit = new vscode.WorkspaceEdit();
                            fix.edit.replace(document.uri, diag.range, suggestion);
                            fix.diagnostics = [diag];
                            fix.isPreferred = extDiag.suggestions.indexOf(suggestion) === 0;
                            actions.push(fix);
                        }
                    }

                    // Add "Ignore" action
                    const ignoreAction = new vscode.CodeAction(
                        'Ignore this issue',
                        vscode.CodeActionKind.QuickFix
                    );
                    ignoreAction.command = {
                        command: 'language-check.ignoreDiagnostic',
                        title: 'Ignore',
                        arguments: [`diag-${diagIndex}`]
                    };
                    ignoreAction.diagnostics = [diag];
                    actions.push(ignoreAction);

                    // Add "Add to Dictionary" action for spelling rules
                    const ruleId = (diag.code as string) || '';
                    if (ruleId.includes('Spell') || ruleId.includes('spell') || ruleId.includes('MORFOLOGIK')) {
                        const word = document.getText(diag.range);
                        const dictAction = new vscode.CodeAction(
                            `Add "${word}" to dictionary`,
                            vscode.CodeActionKind.QuickFix
                        );
                        dictAction.command = {
                            command: 'language-check.addToDictionary',
                            title: 'Add to Dictionary',
                            arguments: [word]
                        };
                        dictAction.diagnostics = [diag];
                        actions.push(dictAction);
                    }
                }

                return actions;
            }
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.ignoreDiagnostic', async (diagnosticId: string) => {
        await ignoreDiagnostic(diagnosticId);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.toggleTrace', () => {
        if (!traceLogger) return;
        const enabled = traceLogger.toggle();
        vscode.window.showInformationMessage(
            `Language Check: Protobuf trace ${enabled ? 'enabled' : 'disabled'}`
        );
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.showTrace', () => {
        traceLogger?.show();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.addToDictionary', async (word: string) => {
        if (!client) return;
        try {
            const response = await client.sendRequest({
                addDictionaryWord: { word }
            });
            if (response.ok) {
                vscode.window.showInformationMessage(`Added "${word}" to dictionary`);
                // Re-check active document to clear spelling diagnostics for this word
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await checkDocument(editor.document);
                }
            } else if (response.error) {
                vscode.window.showErrorMessage(`Failed to add word: ${response.error.message}`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to add word to dictionary: ${err}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.applyFix', async (diagnosticId: string, suggestion: string) => {
        await applyFix(diagnosticId, suggestion);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.selectLanguage', async () => {
        const languages = [
            { label: 'EN-US', description: 'English (US)' },
            { label: 'EN-GB', description: 'English (UK)' },
            { label: 'DE-DE', description: 'German' },
            { label: 'FR', description: 'French' },
            { label: 'ES', description: 'Spanish' },
        ];
        const selected = await vscode.window.showQuickPick(languages, {
            placeHolder: 'Select spell-check language'
        });
        if (selected) {
            languageStatusBarItem.text = `$(book) ${selected.label}`;
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        await checkDocument(editor.document);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkWorkspace', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Checking workspace...",
            cancellable: true
        }, async (progress, token) => {
            const files = await vscode.workspace.findFiles('**/*.{md,html,htm,tex}');
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) break;
                
                const file = files[i];
                if (!file) continue;
                progress.report({ increment: (1 / files.length) * 100, message: `Checking ${path.basename(file.fsPath)}` });
                
                const document = await vscode.workspace.openTextDocument(file);
                await checkDocument(document);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.openSpeedFix', () => {
        if (speedFixPanel) {
            speedFixPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        speedFixPanel = vscode.window.createWebviewPanel(
            'speedFix',
            'SpeedFix',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'out')) // fallback for dev
                ]
            }
        );

        const _webviewDistPath = path.join(context.extensionPath, 'webview', 'dist');
        
        // In dev mode, we might want to point to the dev server, 
        // but for simplicity let's assume we build the webview.
        // Or we can use a simple HTML with script tags.
        
        speedFixPanel.webview.html = getWebviewContent(speedFixPanel.webview, context.extensionPath);

        speedFixPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
            switch (message.type) {
                case 'ready':
                    updateSpeedFixDiagnostics();
                    break;
                case 'applyFix':
                    await applyFix(message.payload.diagnosticId, message.payload.suggestion);
                    break;
                case 'ignore':
                    await ignoreDiagnostic(message.payload.diagnosticId);
                    break;
                case 'addDictionary':
                    await vscode.commands.executeCommand('language-check.addToDictionary', message.payload.diagnosticId);
                    break;
            }
        }, undefined, context.subscriptions);

        speedFixPanel.onDidDispose(() => {
            speedFixPanel = null;
        }, null, context.subscriptions);
    }));

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (supportedLanguages.includes(document.languageId)) {
            await checkDocument(document);
        }
    });

    context.subscriptions.push(diagnosticCollection);

    // Expose public API for other extensions
    const api = createAPI(
        client!,
        async (uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]> => {
            if (!client) return [];
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const languageId = document.languageId;

            try {
                const response = await client.sendRequest({
                    checkProse: { text, languageId, filePath: uri.fsPath }
                });
                if (!response.checkProse?.diagnostics) return [];
                return response.checkProse.diagnostics.map(d => ({
                    startByte: d.startByte ?? 0,
                    endByte: d.endByte ?? 0,
                    message: d.message ?? '',
                    ruleId: d.ruleId ?? '',
                    unifiedId: d.unifiedId ?? '',
                    severity: severityToString(d.severity),
                    suggestions: d.suggestions ?? [],
                    confidence: d.confidence ?? 0,
                }));
            } catch {
                return [];
            }
        },
        context.extension.packageJSON.version ?? '0.0.0',
    );

    return api;
}

function severityToString(severity: number | null | undefined): 'error' | 'warning' | 'information' | 'hint' {
    switch (severity) {
        case 1: return 'error';
        case 2: return 'warning';
        case 3: return 'information';
        case 4: return 'hint';
        default: return 'warning';
    }
}

function getWebviewContent(webview: vscode.Webview, extensionPath: string): string {
    // This should ideally read from webview/dist/index.html and adjust paths
    // For now, a placeholder that points to the built assets
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'index.js')));
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'index.css')));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>SpeedFix</title>
</head>
<body class="bg-vscode-editor-bg text-vscode-editor-fg">
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

async function applyFix(diagnosticId: string, suggestion: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, diagnostic.range, suggestion);
        await vscode.workspace.applyEdit(edit);
    }
}

async function ignoreDiagnostic(diagnosticId: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !client) return;

    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        // Send ignore request to core
        await client.sendRequest({
            ignore: {
                message: diagnostic.message,
                context: editor.document.getText(diagnostic.range) // simplified context
            }
        });
        
        // Re-check document to update squiggles
        await checkDocument(editor.document);
    }
}

interface ExtendedDiagnostic extends vscode.Diagnostic {
    suggestions?: string[];
    confidence?: number;
}

const diagnosticsMap = new Map<string, ExtendedDiagnostic[]>();

function updateSpeedFixDiagnostics() {
    if (!speedFixPanel || !vscode.window.activeTextEditor) return;
    
    const editor = vscode.window.activeTextEditor;
    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
    
    if (diagnostics) {
        const payload: SpeedFixDiagnostic[] = diagnostics.map((d, i) => ({
            id: `diag-${i}`,
            message: d.message,
            suggestions: d.suggestions || [],
            context: editor.document.getText(d.range),
            ruleId: d.code as string || 'unknown'
        }));
        speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload });
    }
}

async function checkDocument(document: vscode.TextDocument) {
    if (!client) return;

    try {
        const response = await client.sendRequest({
            checkProse: {
                text: document.getText(),
                languageId: document.languageId,
                settings: {},
                filePath: document.uri.fsPath
            }
        });

        if (response.checkProse) {
            const extendedDiagnostics: ExtendedDiagnostic[] = response.checkProse.diagnostics!.map(d => {
                const start = document.positionAt(d.startByte as number);
                const end = document.positionAt(d.endByte as number);
                const range = new vscode.Range(start, end);
                
                let severity = vscode.DiagnosticSeverity.Information;
                switch (d.severity) {
                    case languagecheck.Severity.SEVERITY_ERROR: severity = vscode.DiagnosticSeverity.Error; break;
                    case languagecheck.Severity.SEVERITY_WARNING: severity = vscode.DiagnosticSeverity.Warning; break;
                    case languagecheck.Severity.SEVERITY_HINT: severity = vscode.DiagnosticSeverity.Hint; break;
                }

                const diagnostic: ExtendedDiagnostic = new vscode.Diagnostic(range, d.message as string, severity);
                diagnostic.source = 'language-check';
                if (d.ruleId) {
                    diagnostic.code = d.ruleId;
                }
                diagnostic.suggestions = d.suggestions || [];
                if (d.confidence !== null && d.confidence !== undefined) {
                    diagnostic.confidence = d.confidence;
                }
                return diagnostic;
            });

            diagnosticCollection.set(document.uri, extendedDiagnostics);
            diagnosticsMap.set(document.uri.toString(), extendedDiagnostics);
            updateSpeedFixDiagnostics();
            updateInsightsStatusBar(vscode.window.activeTextEditor);
        } else if (response.error) {
            vscode.window.showErrorMessage(`Language Check Error: ${response.error.message}`);
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to communicate with language-check core: ${err}`);
    }
}

function updateInsightsStatusBar(editor?: vscode.TextEditor) {
    if (!editor) {
        insightsStatusBarItem.text = '';
        insightsStatusBarItem.hide();
        return;
    }

    const text = editor.document.getText();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = text.replace(/\s/g, '').length;
    const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

    // ARI (Automated Readability Index)
    let readingLevel = 0;
    if (wordCount > 0 && sentenceCount > 0) {
        readingLevel = 4.71 * (charCount / wordCount) + 0.5 * (wordCount / sentenceCount) - 21.43;
    }

    const rlLabel = readingLevel > 0 ? ` | ARI ${readingLevel.toFixed(1)}` : '';
    insightsStatusBarItem.text = `$(pencil) ${wordCount} words${rlLabel}`;
    insightsStatusBarItem.tooltip = `Words: ${wordCount} | Sentences: ${sentenceCount} | Characters: ${charCount} | Reading Level (ARI): ${readingLevel.toFixed(1)}`;
    insightsStatusBarItem.show();
}

export function deactivate() {
    if (client) {
        client.stop();
        client = null;
    }
}
