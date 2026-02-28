import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from './client';
import { languagecheck } from './proto/checker';
import { TraceLogger } from './trace';
import { createAPI } from './api';
import { binaryExists, downloadBinary } from './downloader';
import type { LanguageCheckDiagnostic } from './api';
import type { SpeedFixDiagnostic, WebviewToExtensionMessage, InspectorToExtensionMessage, InspectorASTNode, InspectorDiagnosticSummary, InspectorCheckInfo } from './events';

const GITHUB_REPO = 'gemini/lang-check';

let client: LanguageClient | null = null;
let traceLogger: TraceLogger | null = null;
const diagnosticCollection = vscode.languages.createDiagnosticCollection('language-check');
let speedFixPanel: vscode.WebviewPanel | null = null;
let inspectorPanel: vscode.WebviewPanel | null = null;
let languageStatusBarItem: vscode.StatusBarItem;
let insightsStatusBarItem: vscode.StatusBarItem;

// Inlay hint invalidation
const inlayHintEmitter = new vscode.EventEmitter<void>();

// Check-on-change debounce timer per document
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

// Checking state (for status bar spinner)
let isChecking = false;

// Last check timing (real benchmark data for inspector)
let lastCheckTimings: { name: string; durationMs: number }[] = [];
let lastCheckInfo: InspectorCheckInfo | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('Language Check extension activated');

    // First-run onboarding: show welcome notification once
    const hasSeenWelcome = context.globalState.get<boolean>('language-check.hasSeenWelcome', false);
    if (!hasSeenWelcome) {
        context.globalState.update('language-check.hasSeenWelcome', true);
        vscode.window.showInformationMessage(
            vscode.l10n.t('Welcome to Language Check! Open the Get Started walkthrough to learn the basics.'),
            vscode.l10n.t('Open Walkthrough'),
            vscode.l10n.t('Dismiss')
        ).then(selection => {
            if (selection === vscode.l10n.t('Open Walkthrough')) {
                vscode.commands.executeCommand(
                    'workbench.action.openWalkthrough',
                    'gemini.extension#language-check.welcome',
                    false
                );
            }
        });
    }

    const resolveBinaryPath = (channel?: string): string => {
        const config = vscode.workspace.getConfiguration('languageCheck');
        const customPath = config.get<string>('core.binaryPath', '');
        if (customPath) return customPath;

        const selectedChannel = channel ?? config.get<string>('core.channel', 'stable');

        if (context.extensionMode === vscode.ExtensionMode.Development) {
            const target = selectedChannel === 'debug' ? 'debug' : 'release';
            return path.join(context.extensionPath, '..', 'rust-core', 'target', target, 'language-check-server');
        }

        switch (selectedChannel) {
            case 'canary':
                return path.join(context.extensionPath, 'bin', 'language-check-server-canary');
            case 'dev':
                return path.join(context.extensionPath, 'bin', 'language-check-server-dev');
            default:
                return path.join(context.extensionPath, 'bin', 'language-check-server');
        }
    };

    const initializeClient = () => {
        if (client && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            client.sendRequest({
                initialize: {
                    workspaceRoot: vscode.workspace.workspaceFolders[0]!.uri.fsPath
                }
            });
        }
    };

    const startClient = (channel?: string) => {
        if (client) {
            client.stop();
        }
        const binaryPath = resolveBinaryPath(channel);
        client = new LanguageClient(binaryPath);
        if (traceLogger) client.setTraceLogger(traceLogger);
        client.onRestart(() => initializeClient());
        client.start();
        traceLogger?.logEvent(`Core started: ${binaryPath} (channel: ${channel ?? 'stable'})`);
    };

    traceLogger = new TraceLogger();
    context.subscriptions.push({ dispose: () => traceLogger?.dispose() });

    // Check if binary exists; offer to download if missing (production only)
    const binDir = path.join(context.extensionPath, 'bin');
    if (context.extensionMode !== vscode.ExtensionMode.Development && !binaryExists(binDir)) {
        vscode.window.showWarningMessage(
            vscode.l10n.t('Core binary not found. Download it now?'),
            vscode.l10n.t('Download'),
            vscode.l10n.t('Manual Setup')
        ).then(async (selection) => {
            if (selection === vscode.l10n.t('Download')) {
                try {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'Language Check',
                            cancellable: false,
                        },
                        (progress) => downloadBinary(binDir, progress),
                    );
                    vscode.window.showInformationMessage(vscode.l10n.t('Core binary downloaded successfully. Restarting...'));
                    startClient();
                    initializeClient();
                } catch (err) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Download failed: {0}', String(err)));
                }
            } else if (selection === vscode.l10n.t('Manual Setup')) {
                vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${GITHUB_REPO}/releases`));
            }
        });
    }

    startClient();

    // Initialize with workspace root
    initializeClient();

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

    // Canonical language IDs with built-in tree-sitter support, plus
    // known VS Code language ID aliases that map to a canonical ID.
    const supportedLanguages = ['markdown', 'html', 'latex', 'forester', 'tinylang', 'rst', 'sweave', 'bibtex', 'org', 'mdx', 'xhtml'];

    // Register Inlay Hints Provider with invalidation support
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguages.map(lang => ({ language: lang })),
        {
            onDidChangeInlayHints: inlayHintEmitter.event,
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
                            const insertMatch = suggestion.match(/^Insert\s+[""\u201C](.+)[""\u201D]$/);
                            const isRemove = suggestion === '';
                            const label = isRemove
                                ? 'Fix: Remove text'
                                : insertMatch && insertMatch[1]
                                    ? `Fix: Insert "${insertMatch[1]}"`
                                    : `Fix: "${suggestion}"`;
                            const fix = new vscode.CodeAction(
                                label,
                                vscode.CodeActionKind.QuickFix
                            );
                            fix.edit = new vscode.WorkspaceEdit();
                            if (insertMatch && insertMatch[1]) {
                                fix.edit.insert(document.uri, diag.range.end, insertMatch[1]);
                            } else {
                                // Empty string = delete the range; otherwise replace
                                fix.edit.replace(document.uri, diag.range, suggestion);
                            }
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
            vscode.l10n.t('Protobuf trace {0}', enabled ? vscode.l10n.t('enabled') : vscode.l10n.t('disabled'))
        );
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.showTrace', () => {
        traceLogger?.show();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.switchCore', async () => {
        const channels = [
            { label: vscode.l10n.t('Stable'), description: vscode.l10n.t('Production release'), channel: 'stable' },
            { label: vscode.l10n.t('Canary'), description: vscode.l10n.t('Pre-release with latest features'), channel: 'canary' },
            { label: vscode.l10n.t('Dev'), description: vscode.l10n.t('Development build (debug symbols)'), channel: 'dev' },
        ];
        const selected = await vscode.window.showQuickPick(channels, {
            placeHolder: vscode.l10n.t('Select core binary channel'),
        });
        if (!selected) return;

        await vscode.workspace.getConfiguration('languageCheck')
            .update('core.channel', selected.channel, vscode.ConfigurationTarget.Global);

        startClient(selected.channel);
        initializeClient();

        vscode.window.showInformationMessage(
            vscode.l10n.t('Switched to {0} core', selected.label)
        );
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.addToDictionary', async (word: string) => {
        if (!client) return;
        sendSpeedFixLoading(true);
        try {
            const response = await client.sendRequest({
                addDictionaryWord: { word }
            });
            if (response.ok) {
                // Optimistic removal: remove all spelling diagnostics for this word immediately
                const editor = vscode.window.activeTextEditor;
                let removedCount = 0;
                const wordLower = word.toLowerCase();
                if (editor) {
                    const uri = editor.document.uri.toString();
                    const diagnostics = diagnosticsMap.get(uri);
                    if (diagnostics) {
                        const remaining = diagnostics.filter(d => {
                            const diagWord = editor.document.getText(d.range);
                            const isSpelling = typeof d.code === 'string' &&
                                (d.code.includes('Spell') || d.code.includes('spell') || d.code.includes('MORFOLOGIK'));
                            if (isSpelling && diagWord.toLowerCase() === wordLower) {
                                removedCount++;
                                return false;
                            }
                            return true;
                        });
                        diagnosticsMap.set(uri, remaining);
                        diagnosticCollection.set(editor.document.uri, remaining);
                        inlayHintEmitter.fire();
                        updateSpeedFixDiagnostics();
                    }
                    // Full re-check for consistency (dictionary is now server-side updated)
                    await checkDocument(editor.document);
                }
                const extra = removedCount > 1 ? vscode.l10n.t(' ({0} occurrences resolved)', removedCount) : '';
                vscode.window.showInformationMessage(vscode.l10n.t('Added "{0}" to dictionary', word) + extra);
            } else if (response.error) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', response.error.message ?? ''));
            }
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', String(err)));
        } finally {
            sendSpeedFixLoading(false);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.applyFix', async (diagnosticId: string, suggestion: string) => {
        await applyFix(diagnosticId, suggestion);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.selectLanguage', async () => {
        const languages = [
            { label: 'EN-US', description: vscode.l10n.t('English (US)') },
            { label: 'EN-GB', description: vscode.l10n.t('English (UK)') },
            { label: 'DE-DE', description: vscode.l10n.t('German') },
            { label: 'FR', description: vscode.l10n.t('French') },
            { label: 'ES', description: vscode.l10n.t('Spanish') },
        ];
        const selected = await vscode.window.showQuickPick(languages, {
            placeHolder: vscode.l10n.t('Select spell-check language')
        });
        if (selected) {
            languageStatusBarItem.text = `$(book) ${selected.label}`;
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const result = await checkDocument(editor.document);
        // Show feedback when invoked manually
        if (result === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No language issues found.'));
        } else if (result > 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('Found {0} issue(s).', result));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkWorkspace', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Checking workspace...'),
            cancellable: true
        }, async (progress, token) => {
            const files = await vscode.workspace.findFiles('**/*.{md,markdown,mdx,html,htm,xhtml,tex,latex,ltx,tree,tiny}');
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) break;

                const file = files[i];
                if (!file) continue;
                progress.report({ increment: (1 / files.length) * 100, message: vscode.l10n.t('Checking {0}', path.basename(file.fsPath)) });

                const document = await vscode.workspace.openTextDocument(file);
                await checkDocument(document);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.openSpeedFix', () => {
        if (speedFixPanel) {
            speedFixPanel.reveal(vscode.ViewColumn.Beside);
            updateSpeedFixDiagnostics();
            return;
        }

        speedFixPanel = vscode.window.createWebviewPanel(
            'speedFix',
            'SpeedFix',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'out'))
                ]
            }
        );

        speedFixPanel.webview.html = getWebviewContent(speedFixPanel.webview, context.extensionPath);

        speedFixPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
            switch (message.type) {
                case 'ready': {
                    const hpm = vscode.workspace.getConfiguration('languageCheck')
                        .get<boolean>('performance.highPerformanceMode', false);
                    speedFixPanel?.webview.postMessage({ type: 'setLowResource', payload: hpm });
                    // If we already have diagnostics, send them immediately
                    updateSpeedFixDiagnostics();
                    // If no diagnostics exist yet, auto-run a check
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && !diagnosticsMap.has(activeEditor.document.uri.toString())) {
                        sendSpeedFixLoading(true);
                        checkDocument(activeEditor.document).then(() => {
                            sendSpeedFixLoading(false);
                        });
                    }
                    break;
                }
                case 'applyFix':
                    await applyFix(message.payload.diagnosticId, message.payload.suggestion);
                    break;
                case 'ignore':
                    await ignoreDiagnostic(message.payload.diagnosticId);
                    speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
                    break;
                case 'addDictionary':
                    await vscode.commands.executeCommand('language-check.addToDictionary', message.payload.word);
                    speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
                    break;
                case 'goToLocation': {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) break;
                    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
                    if (!diagnostics) break;
                    const idx = parseInt(message.payload.diagnosticId.replace('diag-', ''));
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
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        sendSpeedFixLoading(true);
                        await checkDocument(editor.document);
                        sendSpeedFixLoading(false);
                    }
                    break;
                }
                case 'close':
                    speedFixPanel?.dispose();
                    break;
            }
        }, undefined, context.subscriptions);

        speedFixPanel.onDidDispose(() => {
            speedFixPanel = null;
        }, null, context.subscriptions);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.openInspector', () => {
        if (inspectorPanel) {
            inspectorPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        inspectorPanel = vscode.window.createWebviewPanel(
            'inspector',
            'Inspector',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
                ]
            }
        );

        inspectorPanel.webview.html = getInspectorContent(inspectorPanel.webview, context.extensionPath);

        inspectorPanel.webview.onDidReceiveMessage(async (message: InspectorToExtensionMessage) => {
            switch (message.type) {
                case 'inspectorReady': {
                    // If no diagnostics exist yet, auto-run a check first
                    const activeEd = vscode.window.activeTextEditor;
                    if (activeEd && !diagnosticsMap.has(activeEd.document.uri.toString())) {
                        await checkDocument(activeEd.document);
                    }
                    await updateInspectorData();
                    break;
                }
                case 'highlightRange': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const start = editor.document.positionAt(message.payload.startByte);
                        const end = editor.document.positionAt(message.payload.endByte);
                        editor.selection = new vscode.Selection(start, end);
                        editor.revealRange(new vscode.Range(start, end));
                    }
                    break;
                }
            }
        }, undefined, context.subscriptions);

        inspectorPanel.onDidDispose(() => {
            inspectorPanel = null;
        }, null, context.subscriptions);
    }));

    // Update inspector when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async () => {
        await updateInspectorData();
    }));

    // ── Auto-check on document open ──
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (!supportedLanguages.includes(document.languageId)) return;
        if (!client) return; // Client not ready yet
        const trigger = vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger', 'onChange');
        if (trigger === 'onSave') return;
        checkDocument(document);
    }));

    // Also check when the active editor changes (e.g. switching tabs)
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return;
        if (!supportedLanguages.includes(editor.document.languageId)) return;
        if (!client) return;
        const trigger = vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger', 'onChange');
        if (trigger === 'onSave') return;
        // Only check if we don't already have diagnostics for this document
        const uri = editor.document.uri.toString();
        if (!diagnosticsMap.has(uri)) {
            checkDocument(editor.document);
        }
    }));

    // ── Initial check: if there's already an active editor when the extension activates ──
    // This handles window reload where the editor is already open before activation.
    if (vscode.window.activeTextEditor) {
        const doc = vscode.window.activeTextEditor.document;
        if (supportedLanguages.includes(doc.languageId)) {
            const trigger = vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger', 'onChange');
            if (trigger !== 'onSave') {
                // Delay slightly to let the client finish starting
                setTimeout(() => {
                    if (client && !diagnosticsMap.has(doc.uri.toString())) {
                        checkDocument(doc);
                    }
                }, 500);
            }
        }
    }

    // ── Check-on-change with debounce ──
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!supportedLanguages.includes(event.document.languageId)) return;
        const trigger = vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger', 'onChange');
        if (trigger !== 'onChange') return;

        const uri = event.document.uri.toString();
        const existing = debounceTimers.get(uri);
        if (existing) clearTimeout(existing);

        const doc = event.document;
        debounceTimers.set(uri, setTimeout(() => {
            debounceTimers.delete(uri);
            checkDocument(doc);
        }, DEBOUNCE_MS));
    }));

    // Always re-check on save (regardless of trigger mode)
    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (supportedLanguages.includes(document.languageId)) {
            // Cancel any pending debounce for this doc since we're checking now
            const uri = document.uri.toString();
            const existing = debounceTimers.get(uri);
            if (existing) {
                clearTimeout(existing);
                debounceTimers.delete(uri);
            }
            await checkDocument(document);
            await updateInspectorData();
        }
    });

    // Listen for diagnostic changes to keep SpeedFix in sync
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => {
        updateSpeedFixDiagnostics();
    }));

    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(inlayHintEmitter);

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

function sendSpeedFixLoading(loading: boolean) {
    speedFixPanel?.webview.postMessage({ type: 'loading', payload: loading });
}

function setCheckingSpinner(active: boolean) {
    isChecking = active;
    if (active) {
        insightsStatusBarItem.text = `$(sync~spin) Checking...`;
    } else {
        updateInsightsStatusBar(vscode.window.activeTextEditor);
    }
}

function getWebviewContent(webview: vscode.Webview, extensionPath: string): string {
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
<body>
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function getInspectorContent(webview: vscode.Webview, extensionPath: string): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'inspector.js')));
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'inspector.css')));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>Inspector</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

async function updateInspectorData() {
    if (!inspectorPanel) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const text = document.getText();
    const fileName = path.basename(document.uri.fsPath);
    const lines = text.split('\n');

    const children: InspectorASTNode[] = lines.map((line, i) => {
        const startByte = new TextEncoder().encode(lines.slice(0, i).join('\n') + (i > 0 ? '\n' : '')).length;
        const lineBytes = new TextEncoder().encode(line).length;
        return {
            kind: line.trim().startsWith('#') ? 'heading' :
                  line.trim().startsWith('```') ? 'code_fence' :
                  line.trim().startsWith('- ') || line.trim().startsWith('* ') ? 'list_item' :
                  line.trim().startsWith('> ') ? 'block_quote' :
                  line.trim() === '' ? 'blank_line' : 'paragraph',
            startByte,
            endByte: startByte + lineBytes,
            startLine: i,
            startCol: 0,
            endLine: i,
            endCol: line.length,
            children: [],
        };
    });

    const rootNode: InspectorASTNode = {
        kind: 'document',
        startByte: 0,
        endByte: new TextEncoder().encode(text).length,
        startLine: 0,
        startCol: 0,
        endLine: lines.length - 1,
        endCol: lines[lines.length - 1]?.length ?? 0,
        children,
    };

    inspectorPanel.webview.postMessage({
        type: 'setAST',
        payload: { ast: rootNode, fileName },
    });

    const proseRanges = children
        .filter(n => n.kind === 'paragraph' || n.kind === 'heading' || n.kind === 'list_item' || n.kind === 'block_quote')
        .map(n => ({
            startByte: n.startByte,
            endByte: n.endByte,
            text: text.substring(n.startByte, n.endByte),
        }));

    inspectorPanel.webview.postMessage({
        type: 'setProseRanges',
        payload: { prose: proseRanges, ignores: [] },
    });

    // Send real benchmark timings if available
    if (lastCheckTimings.length > 0) {
        inspectorPanel.webview.postMessage({
            type: 'setLatency',
            payload: { stages: lastCheckTimings },
        });
    }

    // Send check info if available
    if (lastCheckInfo) {
        inspectorPanel.webview.postMessage({
            type: 'setCheckInfo',
            payload: lastCheckInfo,
        });
    }

    // Send diagnostic summary
    const diags = diagnosticsMap.get(document.uri.toString());
    if (diags && diags.length > 0) {
        const byRule = new Map<string, number>();
        const bySeverity = new Map<string, number>();
        for (const d of diags) {
            const rule = (d.code as string) || 'unknown';
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
        inspectorPanel.webview.postMessage({
            type: 'setDiagnosticSummary',
            payload: summary,
        });
    }
}

async function applyFix(diagnosticId: string, suggestion: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const uriStr = uri.toString();
    const diagnostics = diagnosticsMap.get(uriStr);
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (!diagnostic) return;

    sendSpeedFixLoading(true);

    try {
        // Apply the fix directly — we are our own code action provider.
        // Handle "Insert" suggestions: `Insert ","` means insert the quoted text
        // at the diagnostic position, not replace the diagnostic range with the
        // literal string `Insert ","`.
        const edit = new vscode.WorkspaceEdit();
        const insertMatch = suggestion.match(/^Insert\s+[""\u201C](.+)[""\u201D]$/);
        if (insertMatch && insertMatch[1]) {
            // Insertion: insert the quoted content at the end of the diagnostic range
            edit.insert(uri, diagnostic.range.end, insertMatch[1]);
        } else {
            edit.replace(uri, diagnostic.range, suggestion);
        }
        await vscode.workspace.applyEdit(edit);

        // Optimistic removal: remove the fixed diagnostic immediately
        const remaining = diagnostics.filter((_, i) => i !== index);
        diagnosticsMap.set(uriStr, remaining);
        diagnosticCollection.set(uri, remaining);
        inlayHintEmitter.fire();
        updateSpeedFixDiagnostics();

        // Background re-check for full consistency
        checkDocument(editor.document);
    } finally {
        sendSpeedFixLoading(false);
        // Refocus the SpeedFix panel so the user can continue through issues
        speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
    }
}

async function ignoreDiagnostic(diagnosticId: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !client) return;

    const uri = editor.document.uri.toString();
    const diagnostics = diagnosticsMap.get(uri);
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        sendSpeedFixLoading(true);
        // Send ignore request to core
        await client.sendRequest({
            ignore: {
                message: diagnostic.message,
                context: editor.document.getText(diagnostic.range)
            }
        });

        // Optimistic removal: remove the ignored diagnostic immediately
        const remaining = diagnostics.filter((_, i) => i !== index);
        diagnosticsMap.set(uri, remaining);
        diagnosticCollection.set(editor.document.uri, remaining);
        inlayHintEmitter.fire();
        updateSpeedFixDiagnostics();
        sendSpeedFixLoading(false);

        // Background re-check for full consistency
        checkDocument(editor.document);
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
    const fileName = path.basename(editor.document.uri.fsPath);

    if (diagnostics && diagnostics.length > 0) {
        const payload: SpeedFixDiagnostic[] = diagnostics.map((d, i) => ({
            id: `diag-${i}`,
            message: d.message,
            suggestions: d.suggestions || [],
            text: editor.document.getText(d.range),
            context: editor.document.lineAt(d.range.start.line).text.trim(),
            ruleId: d.code as string || 'unknown',
            fileName,
            lineNumber: d.range.start.line + 1,
        }));
        speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload });
    } else {
        speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload: [] });
    }
}

/** Returns the number of issues found, or -1 on error. */
async function checkDocument(document: vscode.TextDocument): Promise<number> {
    if (!client) return -1;

    setCheckingSpinner(true);
    const timings: { name: string; durationMs: number }[] = [];

    try {
        const t0 = performance.now();
        const textContent = document.getText();
        timings.push({ name: 'Read document', durationMs: performance.now() - t0 });

        const t1 = performance.now();
        const response = await client.sendRequest({
            checkProse: {
                text: textContent,
                languageId: document.languageId,
                settings: {},
                filePath: document.uri.fsPath
            }
        });
        timings.push({ name: 'Core RPC (checkProse)', durationMs: performance.now() - t1 });

        if (response.checkProse) {
            const t2 = performance.now();
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
            timings.push({ name: 'Map diagnostics', durationMs: performance.now() - t2 });

            const t3 = performance.now();
            diagnosticCollection.set(document.uri, extendedDiagnostics);
            diagnosticsMap.set(document.uri.toString(), extendedDiagnostics);
            inlayHintEmitter.fire();
            updateSpeedFixDiagnostics();
            timings.push({ name: 'Update UI', durationMs: performance.now() - t3 });

            updateInsightsStatusBar(vscode.window.activeTextEditor);

            // Store timings and check info for inspector
            lastCheckTimings = timings;
            lastCheckInfo = {
                fileName: path.basename(document.uri.fsPath),
                fileSize: new TextEncoder().encode(textContent).length,
                languageId: document.languageId,
                proseRangeCount: 0,  // not available from protobuf response
                totalProseBytes: 0,
                diagnosticCount: extendedDiagnostics.length,
            };
            // Update inspector if open
            if (inspectorPanel) {
                inspectorPanel.webview.postMessage({
                    type: 'setLatency',
                    payload: { stages: timings },
                });
                inspectorPanel.webview.postMessage({
                    type: 'setCheckInfo',
                    payload: lastCheckInfo,
                });
            }

            return extendedDiagnostics.length;
        } else if (response.error) {
            vscode.window.showErrorMessage(vscode.l10n.t('Language Check Error: {0}', response.error.message ?? ''));
            return -1;
        }
    } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to communicate with language-check core: {0}', String(err)));
        return -1;
    } finally {
        setCheckingSpinner(false);
    }

    return 0;
}

function updateInsightsStatusBar(editor?: vscode.TextEditor) {
    if (isChecking) return; // Don't overwrite spinner

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
    // Clean up debounce timers
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();

    if (client) {
        client.stop();
        client = null;
    }
}
