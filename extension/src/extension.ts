import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from './client';
import { languagecheck } from './proto/checker';
import { TraceLogger } from './trace';
import { createAPI } from './api';
import { binaryExists, downloadBinary } from './downloader';
import type { LanguageCheckDiagnostic } from './api';
import type { SpeedFixDiagnostic, WebviewToExtensionMessage, InspectorToExtensionMessage, InspectorProseRange, InspectorExclusion, InspectorDiagnosticSummary, InspectorCheckInfo, InspectorEvent } from './events';
import { Logger } from './logger';

const GITHUB_REPO = 'KaiErikNiermann/lang-check';

let client: LanguageClient | null = null;
let traceLogger: TraceLogger | null = null;
let log: Logger;
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

// Concurrency limiter: max simultaneous CheckProse RPCs to avoid flooding
// the server (each LT check holds the orchestrator mutex for seconds).
const MAX_CONCURRENT_CHECKS = 3;
let activeChecks = 0;
const checkQueue: Array<() => void> = [];

/** Acquire a check slot. Resolves immediately if under the limit, otherwise
 *  waits until a slot frees up. */
function acquireCheckSlot(): Promise<void> {
    if (activeChecks < MAX_CONCURRENT_CHECKS) {
        activeChecks++;
        return Promise.resolve();
    }
    return new Promise(resolve => checkQueue.push(resolve));
}

/** Release a check slot and wake the next queued caller, if any. */
function releaseCheckSlot() {
    const next = checkQueue.shift();
    if (next) {
        next(); // slot stays occupied — transferred to the next waiter
    } else {
        activeChecks--;
    }
}

// Checking state (for status bar spinner)
let isChecking = false;

// Last check timing (real benchmark data for inspector)
let lastCheckTimings: { name: string; durationMs: number }[] = [];
let lastCheckInfo: InspectorCheckInfo | null = null;

// Cached extraction data per document URI (from real Rust core response)
const extractionCache = new Map<string, { prose: InspectorProseRange[]; languageId: string }>();

// Tracked english_engine value from config (for change detection + inspector)
let lastKnownEnglishEngine: string | undefined;

// Built-in LaTeX environments that the checker always skips (mirrors SKIP_GENERIC_ENVS in latex.rs)
const BUILTIN_SKIP_ENVS = new Set([
    "algorithm", "algorithmic", "lstlisting",
    "equation", "equation*", "align", "align*",
    "gather", "gather*", "multline", "multline*",
    "flalign", "flalign*", "split",
    "mathpar", "mathpar*",
    "IEEEeqnarray", "IEEEeqnarray*",
    "tikzpicture", "pgfpicture", "forest",
    "tabular", "tabular*", "array",
    "matrix", "bmatrix", "pmatrix", "vmatrix", "Bmatrix", "Vmatrix",
    "cases", "bnf",
]);

// Standard prose-bearing environments — never suggest skipping these since they
// obviously contain text that should be checked.
const PROSE_ENVS = new Set([
    "document",
    "abstract",
    "itemize", "enumerate", "description",
    "figure", "figure*", "table", "table*",
    "minipage", "center", "flushleft", "flushright",
    "quote", "quotation", "verse",
    "theorem", "lemma", "proposition", "corollary", "definition",
    "example", "exercise", "remark", "note", "proof",
    "frame",
]);

// User-configured skip_environments from .languagecheck.yaml
let userSkipEnvs = new Set<string>();

/** Parse skip_environments list items from a YAML config string. */
function parseSkipEnvironments(content: string): Set<string> {
    const envs = new Set<string>();
    const match = content.match(/skip_environments:\s*\n((?:\s+-\s+\S+\n?)*)/);
    if (match?.[1]) {
        for (const line of match[1].split('\n')) {
            const item = line.match(/^\s+-\s+(\S+)/);
            if (item?.[1]) envs.add(item[1]);
        }
    }
    return envs;
}

// Built-in LaTeX commands whose arguments the checker always skips (mirrors SKIP_GENERIC_COMMANDS in latex.rs)
const BUILTIN_SKIP_COMMANDS = new Set([
    "thispagestyle", "pagestyle", "bibliographystyle", "bibliography",
    "setcounter", "addtocounter", "setlength", "addtolength",
    "newcommand", "renewcommand", "newenvironment", "renewenvironment",
    "DeclareMathOperator", "definecolor", "hypersetup", "geometry",
    "input", "include", "hfill", "vfill", "hspace", "vspace",
    "smallskip", "medskip", "bigskip", "hrule", "vrule",
    "newpage", "clearpage", "maketitle",
    "tableofcontents", "listoffigures", "listoftables",
    "texttt", "verb", "lstinline", "mintinline", "url", "href", "path",
]);

// User-configured skip_commands from .languagecheck.yaml
let userSkipCommands = new Set<string>();

/** Parse skip_commands list items from a YAML config string. */
function parseSkipCommands(content: string): Set<string> {
    const cmds = new Set<string>();
    const match = content.match(/skip_commands:\s*\n((?:\s+-\s+\S+\n?)*)/);
    if (match?.[1]) {
        for (const line of match[1].split('\n')) {
            const item = line.match(/^\s+-\s+(\S+)/);
            if (item?.[1]) cmds.add(item[1]);
        }
    }
    return cmds;
}

/** Push a timestamped event to the Inspector event log (if open). */
function pushInspectorEvent(level: InspectorEvent['level'], source: string, message: string, extra?: { durationMs?: number; details?: string }) {
    const evt: InspectorEvent = { timestamp: Date.now(), level, source, message };
    if (extra?.durationMs !== undefined) evt.durationMs = extra.durationMs;
    if (extra?.details !== undefined) evt.details = extra.details;
    inspectorPanel?.webview.postMessage({ type: 'pushEvent', payload: evt });
}

function isSpellingRule(ruleId: string): boolean {
    return ruleId.includes('Spell') || ruleId.includes('spell') || ruleId.includes('MORFOLOGIK');
}

function getDiagnosticWord(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): string {
    return document.getText(diagnostic.range);
}

export async function activate(context: vscode.ExtensionContext) {
    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    log = new Logger(isDev);
    context.subscriptions.push({ dispose: () => log.dispose() });
    log.info('Language Check extension activated', { mode: isDev ? 'dev' : 'prod' });

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
                    'KaiErikNiermann.extension#language-check.welcome',
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

    const initializeClient = async () => {
        if (client && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const root = vscode.workspace.workspaceFolders[0]!.uri.fsPath;
            const indexOnOpen = vscode.workspace.getConfiguration('languageCheck')
                .get<boolean>('workspace.indexOnOpen', false);
            log.debug('Sending Initialize request', { workspaceRoot: root, indexOnOpen });
            pushInspectorEvent('info', 'initialize', `Initializing (indexOnOpen=${indexOnOpen})`);
            const t0 = performance.now();
            await client.sendRequest({
                initialize: { workspaceRoot: root, indexOnOpen }
            });
            pushInspectorEvent('info', 'initialize', 'Server initialized', { durationMs: performance.now() - t0 });
            log.debug('Initialize response received');
        }
    };


    const startClient = (channel?: string) => {
        if (client) {
            log.debug('Stopping existing client');
            client.stop();
        }
        const binaryPath = resolveBinaryPath(channel);
        log.info('Starting core', { binary: binaryPath, channel: channel ?? 'stable' });
        client = new LanguageClient(binaryPath);
        if (traceLogger) client.setTraceLogger(traceLogger);
        client.onRestart(() => initializeClient());
        client.start();
        traceLogger?.logEvent(`Core started: ${binaryPath} (channel: ${channel ?? 'stable'})`);
    };

    traceLogger = new TraceLogger();
    context.subscriptions.push({ dispose: () => traceLogger?.dispose() });

    // Ensure the core binary is available before starting the client.
    // In production mode, automatically download it from GitHub Releases if
    // missing — similar to how the Lean 4 extension bootstraps its server.
    const binDir = path.join(context.extensionPath, 'bin');
    const needsDownload = context.extensionMode !== vscode.ExtensionMode.Development && !binaryExists(binDir);

    const bootClient = () => {
        startClient();
        initializeClient();
    };

    if (needsDownload) {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Language Check: Installing core binary…'),
                cancellable: false,
            },
            async (progress) => {
                try {
                    await downloadBinary(binDir, progress);
                    bootClient();
                } catch (err) {
                    const selection = await vscode.window.showErrorMessage(
                        vscode.l10n.t('Failed to download the core binary: {0}', String(err)),
                        vscode.l10n.t('Retry'),
                        vscode.l10n.t('Download Manually'),
                    );
                    if (selection === vscode.l10n.t('Retry')) {
                        vscode.commands.executeCommand('language-check.downloadBinary');
                    } else if (selection === vscode.l10n.t('Download Manually')) {
                        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${GITHUB_REPO}/releases`));
                    }
                }
            },
        );
    } else {
        bootClient();
    }

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

    /** Re-initialize the server, clear stale diagnostics, and recheck open documents. */
    const reinitializeAndRecheck = async () => {
        log.info('Reinitializing and rechecking');
        await initializeClient();
        diagnosticCollection.clear();
        diagnosticsMap.clear();
        const editors = vscode.window.visibleTextEditors.filter(e =>
            supportedLanguages.includes(e.document.languageId)
        );
        log.debug('Rechecking visible editors', { count: editors.length });
        for (const editor of editors) {
            checkDocument(editor.document);
        }
    };

    // Register Inlay Hints Provider with invalidation support
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguages.map(lang => ({ language: lang })),
        {
            onDidChangeInlayHints: inlayHintEmitter.event,
            provideInlayHints(document, _range, _token) {
                const diagnostics = diagnosticsMap.get(document.uri.toString());
                if (!diagnostics) return [];

                // Group diagnostics by position to avoid stacking hints
                const byPosition = new Map<string, typeof diagnostics>();
                for (const d of diagnostics) {
                    if (d.confidence && d.confidence >= 0.8 && d.suggestions && d.suggestions.length > 0) {
                        const key = `${d.range.end.line}:${d.range.end.character}`;
                        const group = byPosition.get(key);
                        if (group) {
                            group.push(d);
                        } else {
                            byPosition.set(key, [d]);
                        }
                    }
                }

                const hints: vscode.InlayHint[] = [];
                for (const group of byPosition.values()) {
                    if (group.length === 0) continue;
                    const first = group[0]!;
                    const firstIdx = diagnostics.indexOf(first);
                    let label: string;
                    let tooltip: string;
                    if (group.length === 1) {
                        label = ` → ${first.suggestions![0]}`;
                        tooltip = `Accept suggestion: ${first.suggestions![0]}`;
                    } else {
                        label = ` → ${first.suggestions![0]} (+${group.length - 1} more)`;
                        tooltip = group
                            .map((d, i) => `${i + 1}. ${d.message}: ${d.suggestions![0]}`)
                            .join('\n');
                    }
                    const hint = new vscode.InlayHint(
                        first.range.end,
                        [
                            {
                                value: label,
                                command: {
                                    command: 'language-check.applyFix',
                                    title: 'Apply Fix',
                                    arguments: [`diag-${firstIdx}`, first.suggestions![0]]
                                }
                            }
                        ],
                        vscode.InlayHintKind.Type
                    );
                    hint.tooltip = tooltip;
                    hints.push(hint);
                }
                return hints;
            }
        }
    ));

    // Register LaTeX-only Inlay Hints Provider for environment skip hints
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        [{ language: 'latex' }],
        {
            onDidChangeInlayHints: inlayHintEmitter.event,
            provideInlayHints(document, _range, _token) {
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const re = /\\begin\{([^}]+)\}/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const envName = m[1]!;
                    if (BUILTIN_SKIP_ENVS.has(envName) || PROSE_ENVS.has(envName) || userSkipEnvs.has(envName)) continue;
                    const pos = document.positionAt(m.index + m[0].length);
                    const hint = new vscode.InlayHint(
                        pos,
                        [{
                            value: ' \u2298 skip',
                            command: {
                                command: 'language-check.skipLatexEnv',
                                title: 'Skip this LaTeX environment',
                                arguments: [envName]
                            }
                        }],
                        vscode.InlayHintKind.Parameter
                    );
                    hint.tooltip = `Add "${envName}" to skip_environments in .languagecheck.yaml`;
                    hints.push(hint);
                }
                return hints;
            }
        }
    ));

    // Register LaTeX-only Inlay Hints Provider for command skip hints (Approach B: diagnostic-driven)
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        [{ language: 'latex' }],
        {
            onDidChangeInlayHints: inlayHintEmitter.event,
            provideInlayHints(document, _range, _token) {
                const diagnostics = diagnosticsMap.get(document.uri.toString());
                if (!diagnostics || diagnostics.length === 0) return [];
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const seen = new Set<string>();
                const re = /\\([a-zA-Z]+)\{/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const cmdName = m[1]!;
                    if (BUILTIN_SKIP_COMMANDS.has(cmdName) || userSkipCommands.has(cmdName)) continue;
                    // Find the closing brace to get the full argument span
                    const argStart = m.index + m[0].length - 1; // position of '{'
                    let depth = 1;
                    let argEnd = argStart + 1;
                    while (argEnd < text.length && depth > 0) {
                        if (text[argEnd] === '{') depth++;
                        else if (text[argEnd] === '}') depth--;
                        argEnd++;
                    }
                    // Check if any diagnostic falls inside this command's argument
                    const cmdStartPos = document.positionAt(m.index);
                    const cmdEndPos = document.positionAt(argEnd);
                    const cmdRange = new vscode.Range(cmdStartPos, cmdEndPos);
                    const hasDiag = diagnostics.some(d => cmdRange.contains(d.range));
                    if (!hasDiag) continue;
                    // Only show one hint per command name
                    const key = `${cmdName}:${m.index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const pos = document.positionAt(argEnd);
                    const hint = new vscode.InlayHint(
                        pos,
                        [{
                            value: ' \u2298 skip',
                            command: {
                                command: 'language-check.skipLatexCommand',
                                title: 'Skip this LaTeX command',
                                arguments: [cmdName]
                            }
                        }],
                        vscode.InlayHintKind.Parameter
                    );
                    hint.tooltip = `Add "${cmdName}" to skip_commands in .languagecheck.yaml`;
                    hints.push(hint);
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
                    if (isSpellingRule(ruleId)) {
                        const word = getDiagnosticWord(document, diag);
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

                        // "Fix all" bulk actions (only when first suggestion exists)
                        if (extDiag.suggestions && extDiag.suggestions.length > 0) {
                            const replacement = extDiag.suggestions[0]!;
                            const uri = document.uri.toString();

                            // Count matching spelling diagnostics in this file
                            const fileCount = diagnostics.filter(d => {
                                const dRuleId = (d.code as string) || '';
                                return isSpellingRule(dRuleId)
                                    && getDiagnosticWord(document, d) === word;
                            }).length;

                            if (fileCount >= 2) {
                                const fixFileAction = new vscode.CodeAction(
                                    vscode.l10n.t('Fix all "{0}" in this file', word),
                                    vscode.CodeActionKind.QuickFix
                                );
                                fixFileAction.command = {
                                    command: 'language-check.fixAllSpellingInFile',
                                    title: 'Fix all in file',
                                    arguments: [uri, word, replacement]
                                };
                                fixFileAction.diagnostics = [diag];
                                actions.push(fixFileAction);
                            }

                            // Count matching spelling diagnostics across workspace
                            let workspaceCount = 0;
                            for (const [entryUri, entryDiags] of diagnosticsMap) {
                                const entryDoc = vscode.workspace.textDocuments.find(
                                    doc => doc.uri.toString() === entryUri
                                );
                                if (!entryDoc) continue;
                                for (const d of entryDiags) {
                                    const dRuleId = (d.code as string) || '';
                                    if (isSpellingRule(dRuleId)
                                        && getDiagnosticWord(entryDoc, d) === word) {
                                        workspaceCount++;
                                    }
                                }
                            }

                            if (workspaceCount >= 2) {
                                const fixWsAction = new vscode.CodeAction(
                                    vscode.l10n.t('Fix all "{0}" in workspace', word),
                                    vscode.CodeActionKind.QuickFix
                                );
                                fixWsAction.command = {
                                    command: 'language-check.fixAllSpellingInWorkspace',
                                    title: 'Fix all in workspace',
                                    arguments: [word, replacement]
                                };
                                fixWsAction.diagnostics = [diag];
                                actions.push(fixWsAction);
                            }
                        }
                    }
                }

                return actions;
            }
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.downloadBinary', async () => {
        const dir = path.join(context.extensionPath, 'bin');
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Language Check: Installing core binary…'),
                cancellable: false,
            },
            async (progress) => {
                try {
                    await downloadBinary(dir, progress);
                    vscode.window.showInformationMessage(vscode.l10n.t('Core binary installed successfully.'));
                    startClient();
                    initializeClient();
                } catch (err) {
                    const selection = await vscode.window.showErrorMessage(
                        vscode.l10n.t('Failed to download the core binary: {0}', String(err)),
                        vscode.l10n.t('Retry'),
                        vscode.l10n.t('Download Manually'),
                    );
                    if (selection === vscode.l10n.t('Retry')) {
                        vscode.commands.executeCommand('language-check.downloadBinary');
                    } else if (selection === vscode.l10n.t('Download Manually')) {
                        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${GITHUB_REPO}/releases`));
                    }
                }
            },
        );
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.ignoreDiagnostic', async (diagnosticId: string) => {
        await ignoreDiagnostic(diagnosticId);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.fixAllSpellingInFile', async (uri: string, word: string, replacement: string) => {
        const diagnostics = diagnosticsMap.get(uri);
        if (!diagnostics) return;

        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
        if (!document) return;

        const matching = diagnostics.filter(d => {
            const dRuleId = (d.code as string) || '';
            return isSpellingRule(dRuleId) && getDiagnosticWord(document, d) === word;
        });
        if (matching.length === 0) return;

        const edit = new vscode.WorkspaceEdit();
        for (const d of matching) {
            edit.replace(document.uri, d.range, replacement);
        }
        await vscode.workspace.applyEdit(edit);

        // Optimistic removal
        const remaining = diagnostics.filter(d => !matching.includes(d));
        diagnosticsMap.set(uri, remaining);
        diagnosticCollection.set(document.uri, remaining);
        inlayHintEmitter.fire();
        updateSpeedFixDiagnostics();

        // Re-check for consistency
        await checkDocument(document);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.fixAllSpellingInWorkspace', async (word: string, replacement: string) => {
        const edit = new vscode.WorkspaceEdit();
        const affectedUris: string[] = [];

        for (const [uri, diagnostics] of diagnosticsMap) {
            const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
            if (!document) continue;

            const matching = diagnostics.filter(d => {
                const dRuleId = (d.code as string) || '';
                return isSpellingRule(dRuleId) && getDiagnosticWord(document, d) === word;
            });
            if (matching.length === 0) continue;

            for (const d of matching) {
                edit.replace(document.uri, d.range, replacement);
            }

            // Optimistic removal
            const remaining = diagnostics.filter(d => !matching.includes(d));
            diagnosticsMap.set(uri, remaining);
            diagnosticCollection.set(document.uri, remaining);
            affectedUris.push(uri);
        }

        if (affectedUris.length === 0) return;

        await vscode.workspace.applyEdit(edit);
        inlayHintEmitter.fire();
        updateSpeedFixDiagnostics();

        // Re-check all affected files
        for (const uri of affectedUris) {
            const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
            if (document) {
                await checkDocument(document);
            }
        }
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
        const t0 = performance.now();
        log.debug('addToDictionary', { word });
        pushInspectorEvent('info', 'addToDictionary', `Sending request for "${word}"`);
        try {
            const response = await client.sendRequest({
                addDictionaryWord: { word }
            });
            const rpcMs = performance.now() - t0;
            if (response.ok) {
                pushInspectorEvent('info', 'addToDictionary', `Server confirmed "${word}"`, { durationMs: rpcMs });
                // Optimistic removal: remove all spelling diagnostics for this word immediately
                const editor = findEditorWithDiagnostics();
                let removedCount = 0;
                const wordLower = word.toLowerCase();
                if (editor) {
                    const uri = editor.document.uri.toString();
                    const diagnostics = diagnosticsMap.get(uri);
                    if (diagnostics) {
                        const remaining = diagnostics.filter(d => {
                            const diagWord = editor.document.getText(d.range);
                            const isSpelling = typeof d.code === 'string' && isSpellingRule(d.code);
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
                    pushInspectorEvent('debug', 'addToDictionary', `Removed ${removedCount} diagnostics, re-checking`);
                    // Full re-check for consistency (dictionary is now server-side updated)
                    await checkDocument(editor.document);
                }
                const extra = removedCount > 1 ? vscode.l10n.t(' ({0} occurrences resolved)', removedCount) : '';
                vscode.window.showInformationMessage(vscode.l10n.t('Added "{0}" to dictionary', word) + extra);
                pushInspectorEvent('info', 'addToDictionary', `Done`, { durationMs: performance.now() - t0 });
            } else if (response.error) {
                pushInspectorEvent('error', 'addToDictionary', `Server error: ${response.error.message}`, { durationMs: rpcMs });
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', response.error.message ?? ''));
            }
        } catch (err) {
            const errStr = String(err);
            pushInspectorEvent('error', 'addToDictionary', errStr, { durationMs: performance.now() - t0 });
            log.error('addToDictionary failed', { word, error: errStr });
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', errStr));
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

    context.subscriptions.push(vscode.commands.registerCommand('language-check.toggleEnglishEngine', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage(vscode.l10n.t('No workspace folder open.'));
            return;
        }

        // Read current config
        const configNames = ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json'];
        let configUri: vscode.Uri | undefined;
        for (const name of configNames) {
            const uri = vscode.Uri.joinPath(workspaceFolder.uri, name);
            try {
                await vscode.workspace.fs.stat(uri);
                configUri = uri;
                break;
            } catch { /* not found */ }
        }

        // Build choices: always offer harper and languagetool
        const choices = [
            { label: 'harper', description: vscode.l10n.t('Fast, local (default)') },
            { label: 'languagetool', description: vscode.l10n.t('LanguageTool server (deeper analysis)') },
        ];

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: vscode.l10n.t('Select English checking engine'),
        });
        if (!selected) return;

        // Write to config file
        const targetUri = configUri ?? vscode.Uri.joinPath(workspaceFolder.uri, '.languagecheck.yaml');
        try {
            let content: string;
            try {
                const raw = await vscode.workspace.fs.readFile(targetUri);
                content = Buffer.from(raw).toString('utf8');
            } catch {
                content = '';
            }

            if (content.includes('english_engine:')) {
                content = content.replace(/english_engine:\s*\S+/, `english_engine: ${selected.label}`);
            } else if (content.includes('engines:')) {
                content = content.replace(/engines:/, `engines:\n  english_engine: ${selected.label}`);
            } else {
                content = `engines:\n  english_engine: ${selected.label}\n${content}`;
            }

            // Auto-enable the languagetool flag when selecting it as the engine
            if (selected.label === 'languagetool' && !content.match(/languagetool:\s*true/)) {
                if (content.match(/languagetool:\s*false/)) {
                    content = content.replace(/languagetool:\s*false/, 'languagetool: true');
                } else if (content.includes('engines:')) {
                    content = content.replace(/engines:/, 'engines:\n  languagetool: true');
                }
            }

            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
            vscode.window.showInformationMessage(
                vscode.l10n.t('English engine set to "{0}". Reloading...', selected.label)
            );
            await reinitializeAndRecheck();
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to update config: {0}', String(err)));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.skipLatexEnv', async (envName: string) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage(vscode.l10n.t('No workspace folder open.'));
            return;
        }

        const configNames = ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json'];
        let configUri: vscode.Uri | undefined;
        for (const name of configNames) {
            const uri = vscode.Uri.joinPath(workspaceFolder.uri, name);
            try {
                await vscode.workspace.fs.stat(uri);
                configUri = uri;
                break;
            } catch { /* not found */ }
        }

        const targetUri = configUri ?? vscode.Uri.joinPath(workspaceFolder.uri, '.languagecheck.yaml');
        try {
            let content: string;
            try {
                const raw = await vscode.workspace.fs.readFile(targetUri);
                content = Buffer.from(raw).toString('utf8');
            } catch {
                content = '';
            }

            if (content.match(/skip_environments:/)) {
                content = content.replace(/skip_environments:/, `skip_environments:\n      - ${envName}`);
            } else if (content.match(/latex:/)) {
                content = content.replace(/latex:/, `latex:\n    skip_environments:\n      - ${envName}`);
            } else if (content.match(/languages:/)) {
                content = content.replace(/languages:/, `languages:\n  latex:\n    skip_environments:\n      - ${envName}`);
            } else {
                content = `languages:\n  latex:\n    skip_environments:\n      - ${envName}\n${content}`;
            }

            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
            vscode.window.showInformationMessage(
                vscode.l10n.t('Added "{0}" to skip list. Rechecking...', envName)
            );
            userSkipEnvs.add(envName);
            inlayHintEmitter.fire();
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to update config: {0}', String(err)));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.skipLatexCommand', async (cmdName: string) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage(vscode.l10n.t('No workspace folder open.'));
            return;
        }

        const configNames = ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json'];
        let configUri: vscode.Uri | undefined;
        for (const name of configNames) {
            const uri = vscode.Uri.joinPath(workspaceFolder.uri, name);
            try {
                await vscode.workspace.fs.stat(uri);
                configUri = uri;
                break;
            } catch { /* not found */ }
        }

        const targetUri = configUri ?? vscode.Uri.joinPath(workspaceFolder.uri, '.languagecheck.yaml');
        try {
            let content: string;
            try {
                const raw = await vscode.workspace.fs.readFile(targetUri);
                content = Buffer.from(raw).toString('utf8');
            } catch {
                content = '';
            }

            if (content.match(/skip_commands:/)) {
                content = content.replace(/skip_commands:/, `skip_commands:\n      - ${cmdName}`);
            } else if (content.match(/latex:/)) {
                content = content.replace(/latex:/, `latex:\n    skip_commands:\n      - ${cmdName}`);
            } else if (content.match(/languages:/)) {
                content = content.replace(/languages:/, `languages:\n  latex:\n    skip_commands:\n      - ${cmdName}`);
            } else {
                content = `languages:\n  latex:\n    skip_commands:\n      - ${cmdName}\n${content}`;
            }

            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
            vscode.window.showInformationMessage(
                vscode.l10n.t('Added "{0}" to skip_commands. Rechecking...', cmdName)
            );
            userSkipCommands.add(cmdName);
            inlayHintEmitter.fire();
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to update config: {0}', String(err)));
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
        // Capture the active editor before creating the panel, since the
        // webview will steal focus and make activeTextEditor undefined.
        const originEditor = vscode.window.activeTextEditor;

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
                    // If no diagnostics exist yet, auto-run a check using the
                    // editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !diagnosticsMap.has(editorForCheck.document.uri.toString())) {
                        sendSpeedFixLoading(true);
                        checkDocument(editorForCheck.document).then(() => {
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
        // Capture the active editor before creating the panel, since the
        // webview will steal focus and make activeTextEditor undefined.
        const originEditor = vscode.window.activeTextEditor;

        if (inspectorPanel) {
            inspectorPanel.reveal(vscode.ViewColumn.Beside);
            updateInspectorData();
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
                    // Use the editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !diagnosticsMap.has(editorForCheck.document.uri.toString())) {
                        await checkDocument(editorForCheck.document);
                    }
                    await updateInspectorData();
                    break;
                }
                case 'highlightRange': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const buf = Buffer.from(editor.document.getText(), 'utf8');
                        const start = editor.document.positionAt(buf.subarray(0, message.payload.startByte).toString('utf8').length);
                        const end = editor.document.positionAt(buf.subarray(0, message.payload.endByte).toString('utf8').length);
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
    // Guard: only check documents visible in an editor tab.
    // VS Code fires onDidOpenTextDocument for background loads (search, git, etc.)
    // which would flood the server with hundreds of concurrent checks.
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (!supportedLanguages.includes(document.languageId)) return;
        if (!client) return;
        const trigger = vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger', 'onChange');
        if (trigger === 'onSave') return;
        const isVisible = vscode.window.visibleTextEditors.some(
            e => e.document.uri.toString() === document.uri.toString()
        );
        if (!isVisible) return;
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

    // Watch .languagecheck config files for english_engine changes
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.languagecheck.{yaml,yml,json}');
    const checkEnglishEngineChange = async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        for (const name of ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json']) {
            const uri = vscode.Uri.joinPath(folder.uri, name);
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                const match = raw.match(/english_engine:\s*(\S+)/);
                const current = match?.[1] ?? 'harper';
                if (lastKnownEnglishEngine !== undefined && current !== lastKnownEnglishEngine) {
                    log.info('English engine changed via config file', { from: lastKnownEnglishEngine, to: current });
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('English engine changed to "{0}"', current)
                    );
                    reinitializeAndRecheck();
                }
                lastKnownEnglishEngine = current;
                userSkipEnvs = parseSkipEnvironments(raw);
                userSkipCommands = parseSkipCommands(raw);
                inlayHintEmitter.fire();
                return;
            } catch { /* not found, try next */ }
        }
    };
    configWatcher.onDidChange(checkEnglishEngineChange);
    configWatcher.onDidCreate(checkEnglishEngineChange);
    context.subscriptions.push(configWatcher);

    // Eagerly read the initial english_engine value so we can detect changes
    // even if the config was modified before the extension activated.
    {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (folder) {
            for (const name of ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json']) {
                const uri = vscode.Uri.joinPath(folder.uri, name);
                try {
                    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                    const match = raw.match(/english_engine:\s*(\S+)/);
                    lastKnownEnglishEngine = match?.[1] ?? 'harper';
                    userSkipEnvs = parseSkipEnvironments(raw);
                userSkipCommands = parseSkipCommands(raw);
                    break;
                } catch { /* not found, try next */ }
            }
        }
        if (lastKnownEnglishEngine === undefined) {
            lastKnownEnglishEngine = 'harper';
        }
    }

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

    // Prefer active editor, fall back to a visible editor with diagnostics.
    // When the inspector panel has focus, activeTextEditor is undefined.
    const editor = vscode.window.activeTextEditor
        ?? findEditorWithDiagnostics()
        ?? vscode.window.visibleTextEditors[0];
    if (!editor) return;

    const document = editor.document;
    const uri = document.uri.toString();
    const fileName = path.basename(document.uri.fsPath);

    // Send real extraction data from cache
    const cached = extractionCache.get(uri);
    inspectorPanel.webview.postMessage({
        type: 'setExtraction',
        payload: {
            prose: cached?.prose ?? [],
            fileName,
            languageId: cached?.languageId ?? document.languageId,
        },
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
    const diags = diagnosticsMap.get(uri);
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

/** Find a text editor that has diagnostics, preferring activeTextEditor.
 *  Falls back to visibleTextEditors when a webview panel has stolen focus. */
function findEditorWithDiagnostics(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && diagnosticsMap.has(active.document.uri.toString())) return active;
    // Fallback: find a visible editor that has diagnostics
    return vscode.window.visibleTextEditors.find(e =>
        diagnosticsMap.has(e.document.uri.toString())
    );
}

async function applyFix(diagnosticId: string, suggestion: string) {
    const editor = findEditorWithDiagnostics();
    if (!editor) return;

    const uri = editor.document.uri;
    const uriStr = uri.toString();
    const diagnostics = diagnosticsMap.get(uriStr);
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (!diagnostic) return;

    const t0 = performance.now();
    const origText = editor.document.getText(diagnostic.range);
    log.debug('applyFix', { diagnosticId, suggestion, original: origText });
    pushInspectorEvent('info', 'applyFix', `"${origText}" → "${suggestion}"`);
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
        pushInspectorEvent('debug', 'applyFix', 'Re-checking after fix', { durationMs: performance.now() - t0 });
        checkDocument(editor.document);
    } finally {
        sendSpeedFixLoading(false);
        // Refocus the SpeedFix panel so the user can continue through issues
        speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
    }
}

async function ignoreDiagnostic(diagnosticId: string) {
    const editor = findEditorWithDiagnostics();
    if (!editor || !client) return;

    const uri = editor.document.uri.toString();
    const diagnostics = diagnosticsMap.get(uri);
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        sendSpeedFixLoading(true);
        const t0 = performance.now();
        const ignoredText = editor.document.getText(diagnostic.range);
        pushInspectorEvent('info', 'ignoreDiagnostic', `Ignoring "${ignoredText}" (${diagnostic.message})`);
        // Send ignore request to core with full document text + original byte
        // offsets so the fingerprint matches the one created during checkProse.
        await client.sendRequest({
            ignore: {
                message: diagnostic.message,
                context: editor.document.getText(diagnostic.range),
                text: editor.document.getText(),
                startByte: diagnostic.coreStartByte ?? 0,
                endByte: diagnostic.coreEndByte ?? 0,
            }
        });

        // Optimistic removal: remove the ignored diagnostic immediately
        const remaining = diagnostics.filter((_, i) => i !== index);
        diagnosticsMap.set(uri, remaining);
        diagnosticCollection.set(editor.document.uri, remaining);
        inlayHintEmitter.fire();
        updateSpeedFixDiagnostics();
        sendSpeedFixLoading(false);
        pushInspectorEvent('info', 'ignoreDiagnostic', 'Ignore confirmed, re-checking', { durationMs: performance.now() - t0 });

        // Background re-check for full consistency
        checkDocument(editor.document);
    }
}

interface ExtendedDiagnostic extends vscode.Diagnostic {
    suggestions?: string[];
    confidence?: number;
    /** Original byte offsets from the core, needed for fingerprint matching. */
    coreStartByte?: number;
    coreEndByte?: number;
}

const diagnosticsMap = new Map<string, ExtendedDiagnostic[]>();

function updateSpeedFixDiagnostics() {
    if (!speedFixPanel) return;
    const editor = findEditorWithDiagnostics() ?? vscode.window.activeTextEditor;
    if (!editor) return;

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

    const shortName = path.basename(document.fileName);
    log.debug('checkDocument', { file: document.fileName, lang: document.languageId });
    pushInspectorEvent('info', 'checkDocument', `Checking ${shortName} (${document.languageId})`);

    // Wait for a concurrency slot so we don't flood the server
    await acquireCheckSlot();
    setCheckingSpinner(true);
    const timings: { name: string; durationMs: number }[] = [];

    try {
        const t0 = performance.now();
        const textContent = document.getText();
        timings.push({ name: 'Read document', durationMs: performance.now() - t0 });

        const t1 = performance.now();
        pushInspectorEvent('debug', 'checkDocument', `Sending CheckProse RPC (${textContent.length} chars)`);
        const response = await client.sendRequest({
            checkProse: {
                text: textContent,
                languageId: document.languageId,
                settings: {},
                filePath: document.uri.fsPath
            }
        });
        const rpcMs = performance.now() - t1;
        timings.push({ name: 'Core RPC (checkProse)', durationMs: rpcMs });
        pushInspectorEvent('info', 'checkDocument', `RPC response received`, { durationMs: rpcMs });

        if (response.checkProse) {
            const t2 = performance.now();
            // Core returns UTF-8 byte offsets; positionAt expects char offsets.
            // Pre-compute the UTF-8 buffer once so we can convert efficiently.
            const textBuf = Buffer.from(textContent, 'utf8');
            const byteToChar = (byteOff: number) =>
                textBuf.subarray(0, byteOff).toString('utf8').length;
            const extendedDiagnostics: ExtendedDiagnostic[] = response.checkProse.diagnostics!.map(d => {
                const start = document.positionAt(byteToChar(d.startByte as number));
                const end = document.positionAt(byteToChar(d.endByte as number));
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
                diagnostic.coreStartByte = d.startByte as number;
                diagnostic.coreEndByte = d.endByte as number;
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

            // Cache extraction data from real Rust core response
            const protoRanges = response.checkProse.extraction?.proseRanges ?? [];
            const inspectorRanges: InspectorProseRange[] = protoRanges.map(pr => {
                const startByte = pr.startByte as number;
                const endByte = pr.endByte as number;
                const rawText = textContent.substring(
                    byteToChar(startByte),
                    byteToChar(endByte),
                );

                const exclusions: InspectorExclusion[] = (pr.exclusions ?? []).map(exc => {
                    const excStartByte = exc.startByte as number;
                    const excEndByte = exc.endByte as number;
                    // Convert document-level byte offsets to char offsets within the range text
                    const excStartChar = byteToChar(excStartByte) - byteToChar(startByte);
                    const excEndChar = byteToChar(excEndByte) - byteToChar(startByte);
                    const excText = rawText.substring(excStartChar, excEndChar);

                    // Infer exclusion kind heuristically from content.
                    // Trim leading/trailing whitespace since install_skip_exclusions
                    // extends exclusion ranges to cover surrounding whitespace.
                    const trimmed = excText.trim();
                    let kind = 'unknown';
                    if (trimmed.startsWith('##{') || trimmed.startsWith('\\[')) kind = 'display_math';
                    else if (trimmed.startsWith('#{') || trimmed.startsWith('$')) kind = 'inline_math';
                    else if (/^\\[a-zA-Z]/.test(trimmed)) kind = 'command';
                    else if (trimmed.startsWith('\\')) kind = 'escape';
                    else if (trimmed.startsWith('%')) kind = 'comment';
                    else if (/^\[.*\]\(.*\)$/.test(trimmed)) kind = 'link';
                    else if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) kind = 'link';
                    else if (/^[{}[\]()]+$/.test(trimmed)) kind = 'delimiter';
                    else if (trimmed === '') kind = 'whitespace';

                    return { startChar: excStartChar, endChar: excEndChar, kind, text: excText };
                });

                // Build clean text: replace exclusion zones with spaces
                let cleanText = rawText;
                if (exclusions.length > 0) {
                    const chars = [...cleanText];
                    for (const exc of exclusions) {
                        for (let i = exc.startChar; i < exc.endChar && i < chars.length; i++) {
                            chars[i] = ' ';
                        }
                    }
                    cleanText = chars.join('');
                }

                return { startByte, endByte, text: rawText, cleanText, exclusions };
            });

            extractionCache.set(document.uri.toString(), {
                prose: inspectorRanges,
                languageId: document.languageId,
            });

            // Store timings and check info for inspector
            lastCheckTimings = timings;
            const totalProseBytes = inspectorRanges.reduce((sum, r) => sum + (r.endByte - r.startByte), 0);
            lastCheckInfo = {
                fileName: path.basename(document.uri.fsPath),
                fileSize: new TextEncoder().encode(textContent).length,
                languageId: document.languageId,
                proseRangeCount: inspectorRanges.length,
                totalProseBytes,
                diagnosticCount: extendedDiagnostics.length,
                englishEngine: lastKnownEnglishEngine ?? 'harper',
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

            pushInspectorEvent('info', 'checkDocument', `${extendedDiagnostics.length} issues in ${shortName}`, { durationMs: performance.now() - t0 });
            return extendedDiagnostics.length;
        } else if (response.error) {
            pushInspectorEvent('error', 'checkDocument', `Server error: ${response.error.message}`);
            vscode.window.showErrorMessage(vscode.l10n.t('Language Check Error: {0}', response.error.message ?? ''));
            return -1;
        }
    } catch (err) {
        const errStr = String(err);
        log.error('checkDocument failed', { error: errStr, file: document.fileName });
        pushInspectorEvent('error', 'checkDocument', errStr, { details: document.fileName });
        if (errStr.includes('timed out')) {
            log.warn('Request timed out — the core process may be busy or the LanguageTool server unresponsive');
        } else {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to communicate with language-check core: {0}', errStr));
        }
        return -1;
    } finally {
        releaseCheckSlot();
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
