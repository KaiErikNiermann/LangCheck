import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile, execSync } from 'child_process';
import { TraceLogger } from './shared/trace';
import { createAPI } from './api';
import { formatSuggestionLabel, speedFixSuggestionLabel, displayOriginalText } from './shared/inlayLabels';
import type { LanguageCheckDiagnostic } from './api';
import { parseDictionaryPaths, wordsAdded } from './config/parsing';
import {
    declinePack,
    forgetDecline,
    isLanguageTag,
    languageToolCovers,
    shouldPrompt,
    uncheckedLanguages,
} from './core/packPrompt';
import { YAML_EXTENSION_ID, declineYamlSuggestion, shouldSuggestYaml } from './config/yamlSuggestion';
import type { SpeedFixDiagnostic, SpeedFixScope, WebviewToExtensionMessage, InspectorToExtensionMessage, InspectorDiagnosticSummary, InspectorEngineInfo } from './ui/webviews/protocol';
import { Logger } from './shared/logger';
import { ConfigStatusView } from './config/gutter';
import { classifyConfigChange, silencedBy } from './config/rules';
import { engines as enginesBehind, spanned } from './shared/ignoreSpan';
import {
    addLatexListEntry,
    deactivateRule,
    type LatexList,
    engineEnabled,
    setEngineEnabled,
    setSpellLanguage,
    spellLanguageOf,
} from './config/edits';
import {
    CONFIG_FILE_NAMES,
    readConfigText,
    readFirstConfig,
    resolveConfigForEdit,
    showConfigUpdateError,
    workspaceFolderOrWarn,
    writeConfigText,
} from './config/file';
import {
    addSuggestionEdit,
    diagId,
    getDiagnosticWord,
    ignoreRequest,
    insertedText,
    isSpellingOf,
    isSpellingRule,
    parseDiagId,
    ruleIdOf,
    type ExtendedDiagnostic,
} from './diagnostics/diagnostic';
import { findOpenDocument } from './shared/documents';
import { DiagnosticStore, Suppression } from './diagnostics/store';
import { CheckResults } from './checking/results';
import { InspectorLog } from './ui/inspectorLog';
import { COMMANDS, commandLink, executeCommand, registerCommand } from './commands/ids';
import { getSetting, getUndeclaredSetting, settingId, updateSetting, type SettingValue } from './config/settings';
import { GITHUB_REPO } from './shared/links';
import { BUILTIN_SKIP_COMMANDS, BUILTIN_SKIP_ENVS, PROSE_COMMANDS, PROSE_ENVS } from './providers/latexLists';
import { SUPPORTED_LANGUAGES, supportedLanguageSelector } from './checking/languages';
import { byteToCharConverter } from './checking/offsets';
import { webviewHtml } from './ui/webviews/html';
import { StatusBars } from './ui/statusBars';
import { CoreService } from './core/coreService';
import { Checker, type CheckOutcome } from './checking/checker';
import { Debouncer } from './checking/scheduler';
import { hasDockerCompose, restartLanguageToolDocker } from './core/languagetool';
import { bootstrapCore, downloadFailedMessage, downloadWithProgress, onDownloadFailedChoice } from './core/binary';
import { WorkspaceConfigState } from './config/state';
import { createServices } from './services';

let core: CoreService;
let checker: Checker;

let log: Logger;
// Created in activate() by createServices(); see services.ts.
let store: DiagnosticStore;
let suppression: Suppression;
let results: CheckResults;
let statusBars: StatusBars;
let configState: WorkspaceConfigState;
let inspectorLog: InspectorLog;
let inlayHintEmitter: vscode.EventEmitter<void>;
let speedFixPanel: vscode.WebviewPanel | null = null;
let inspectorPanel: vscode.WebviewPanel | null = null;
let configStatusView: ConfigStatusView | null = null;

// SpeedFix scope (file vs workspace)
let speedFixScope: SpeedFixScope = 'file';
let speedFixTargetUri: string | null = null;

// Engine health tracking
let engineInfoState: InspectorEngineInfo[] = [];

// Inlay hint invalidation
let inlayHintsEnabled = true;

/**
 * How sure an engine has to be before its suggestion is shown inline.
 *
 * Harper and LanguageTool report 0.8, Vale 0.75, proselint 0.7 and Hunspell
 * 0.6, so at this floor the first two reach the hint and the rest stay in the
 * quick fix menu. A hint is applied with one keystroke and sits in the text,
 * which is a different bar from a menu entry someone chose to open.
 */
const HINT_CONFIDENCE_FLOOR = 0.8;

// Check-on-change debounce timer per document
const debouncer = new Debouncer();

/**
 * Languages offered this session.
 *
 * Separate from the permanent decline list: dismissing the modal without
 * choosing is not a refusal, so it is not remembered past the session, but it
 * should not re-fire on the next keystroke either.
 */
const packsOfferedThisSession = new Set<string>();
let yamlOfferedThisSession = false;
/** Set once on activation, so the pack code can reach global state. */
let extensionContext: vscode.ExtensionContext | undefined;
/** Re-check after an install, without hoisting the whole closure out. */
let reinitializeAndRecheckRef: (() => Promise<void>) | undefined;


export async function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    log = new Logger(isDev);
    context.subscriptions.push({ dispose: () => log.dispose() });

    ({ store, suppression, results, statusBars, configState, inspectorLog, inlayHintEmitter } = createServices());
    // What every diagnostics change refreshes, in this order.
    store.onChange(() => inlayHintEmitter.fire());
    store.onChange(() => updateSpeedFixDiagnostics());
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
                    // Derive the id from the running extension rather than hardcoding
                    // publisher.name — the literal was wrong (`.extension`) and would
                    // break again under a different registry namespace.
                    `${context.extension.id}#language-check.welcome`,
                    false
                );
            }
        });
    }

    const suggestYamlExtension = async (document: vscode.TextDocument): Promise<void> => {
        const installed = vscode.extensions.getExtension(YAML_EXTENSION_ID) !== undefined;
        if (!shouldSuggestYaml(context.globalState, yamlOfferedThisSession, installed, document.uri.fsPath)) return;
        yamlOfferedThisSession = true;
        const install = vscode.l10n.t('Install');
        const never = vscode.l10n.t("Don't ask again");
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Install the Red Hat YAML extension for completion and validation in .languagecheck.yaml?'),
            install,
            vscode.l10n.t('Not now'),
            never,
        );
        if (choice === install) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', YAML_EXTENSION_ID);
        } else if (choice === never) {
            await declineYamlSuggestion(context.globalState);
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => void suggestYamlExtension(document)));
    for (const document of vscode.workspace.textDocuments) void suggestYamlExtension(document);

    const traceLogger = new TraceLogger();
    context.subscriptions.push({ dispose: () => traceLogger.dispose() });
    core = new CoreService(context, log, inspectorLog, statusBars, traceLogger, {
        booted: () => {
            checkVisibleUnchecked();
            // The core is what answers a probe, so every config on screen is
            // stale until it is up -- and stale again after a restart, which is
            // why this is here rather than only at activation.
            configStatusView?.refresh();
        },
        restarted: () => checkVisibleUnchecked(),
    });
    checker = new Checker({
        core, log, store, suppression, results, statusBars, inspectorLog,
        observer: {
            // Update inspector if open
            checkRecorded: timings => {
                if (inspectorPanel) {
                    inspectorPanel.webview.postMessage({
                        type: 'setLatency',
                        payload: { stages: timings },
                    });
                    inspectorPanel.webview.postMessage({
                        type: 'setCheckInfo',
                        payload: results.info,
                    });
                }
            },
            // Post health to Inspector
            healthUpdated: () => {
                if (inspectorPanel) {
                    inspectorPanel.webview.postMessage({
                        type: 'setEngineHealth',
                        payload: results.engineHealth,
                    });
                }
            },
            diagnosticsPublished: diagnostics => void offerMissingPacks(diagnostics),
        },
    });

    /**
     * When a document is re-checked after its first check.
     *
     * The fallback matters: every reader used to pass `'onChange'` while
     * package.json declares `'onSave'`, and the manifest wins, so the code
     * said one thing and the extension did the other.
     */
    const checkTrigger = () =>
        getSetting('check.trigger');

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
    const checkIfUnchecked = (document: vscode.TextDocument) => {
        // Not a started client: a check sent between the process starting and
        // Initialize returning is answered with an empty dictionary. The
        // documents skipped here are picked up by `checkVisibleUnchecked` as
        // soon as Initialize returns.
        if (!core.ready()) return;
        if (!isCheckable(document)) return;
        if (store.has(document.uri.toString())) return;
        checker.check(document);
    };

    /**
     * Check everything visible that has no diagnostics yet.
     *
     * Called once the core is up. The open and tab-switch handlers both return
     * early when `client` is still null, and a document that arrived during
     * startup was dropped with nothing to retry it -- the sole fallback was a
     * 500 ms timer, which loses whenever the binary takes longer than that to
     * start. Driving the retry off the core being ready removes the guess.
     */
    const checkVisibleUnchecked = () => {
        for (const editor of vscode.window.visibleTextEditors) {
            checkIfUnchecked(editor.document);
        }
    };

    configStatusView = new ConfigStatusView(
        context.extensionUri,
        (text, filePath, format) => core.probeConfig(text, filePath, format),
        log,
    );
    configStatusView.activate();
    context.subscriptions.push(configStatusView);

    /**
     * The model behind the gutter marks, for the end-to-end tests.
     *
     * VS Code's decoration API is write-only -- nothing can read back what an
     * extension drew -- so a test that wants to know which icon is on which
     * line has to be handed the state the extension pushed. This is that
     * state, at the last point the extension controls.
     */
    context.subscriptions.push(registerCommand(COMMANDS.configStatus,
        (uri?: string) => uri === undefined
            ? configStatusView?.allSnapshots() ?? []
            : configStatusView?.snapshot(uri) ?? undefined,
    ));

    const downloading = bootstrapCore(context, log, () => core.boot());
    if (downloading) await downloading;

    // Status bars: spell-check language, and prose insights (word count, reading level)
    statusBars.create(context.subscriptions);

    // Update insights when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => statusBars.updateInsights(editor)));

    /**
     * Whether this extension should check a document.
     *
     * Two ways to qualify. VS Code's language id, for the formats there are
     * grammars for -- and the file's extension, for the ones only an SLS
     * schema handles. A schema language has no language id in VS Code, so
     * checking the id alone made every schema unreachable from the editor
     * however correct it was: the core would have used it, and was never
     * asked.
     */
    const isCheckable = (document: vscode.TextDocument): boolean => {
        if (SUPPORTED_LANGUAGES.includes(document.languageId)) return true;
        const extension = path.extname(document.fileName).replace(/^\./, '').toLowerCase();
        return extension.length > 0 && core.schemaExtensions.has(extension);
    };

    /** Re-initialize the server, clear stale diagnostics, and recheck open documents. */
    const reinitializeAndRecheck = async () => {
        log.info('Reinitializing and rechecking');
        await core.initialize();
        store.clear();
        // The inspector reports which language each range was checked in. Under
        // a new config that answer may have changed, and showing the old one is
        // worse than showing none, so it goes until the re-check replaces it.
        results.clearDocuments();
        await updateInspectorData();
        const editors = vscode.window.visibleTextEditors.filter(e => isCheckable(e.document));
        log.debug('Rechecking visible editors', { count: editors.length });
        for (const editor of editors) {
            checker.check(editor.document);
        }
    };
    // A config change rebuilds the client and clears the caches. It must not
    // clear which packs the user refused: that is their standing answer, not
    // state derived from the config.
    reinitializeAndRecheckRef = reinitializeAndRecheck;

    /**
     * Apply a config change that can only remove diagnostics.
     *
     * Silencing a rule is applied by the core after the engines have run, so
     * checking again produces the same findings and drops one more of them.
     * The answer is already on screen; all that is needed is the same filter
     * the core would apply, and the core told about the new config so the
     * next check it runs for any other reason agrees.
     *
     * Re-checking instead is not merely slower. `reinitializeAndRecheck`
     * clears every diagnostic first, so the whole file goes blank and fills
     * back in -- for a rule the user silenced precisely because they did not
     * want to look at it.
     */
    const applySilencedRules = async (newlyOff: ReadonlySet<string>) => {
        log.info('Config silenced rules, filtering in place', { rules: [...newlyOff] });
        for (const [uri, diagnostics] of store) {
            const remaining = diagnostics.filter(
                d => !silencedBy(newlyOff, ruleIdOf(d, undefined), d.unifiedId),
            );
            if (remaining.length === diagnostics.length) continue;
            store.write(uri, vscode.Uri.parse(uri), remaining);
        }
        store.notify();
        statusBars.updateInsights(vscode.window.activeTextEditor);
        // Last, and without clearing anything: the core needs the new config
        // for whatever it is asked next, but nothing on screen depends on it.
        await core.initialize();
    };

    /** Format an inlay hint label and apply-value for a diagnostic suggestion. */
    function formatInlayLabel(
        d: { suggestions?: string[]; range: vscode.Range },
        document: vscode.TextDocument
    ): { label: string; applyValue: string } | null {
        const suggestion = d.suggestions?.[0];
        if (suggestion === undefined) return null;
        return formatSuggestionLabel(document.getText(d.range), suggestion);
    }

    // Register Inlay Hints Provider with invalidation support
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguageSelector(),
        {
            onDidChangeInlayHints: inlayHintEmitter.event,
            provideInlayHints(document, _range, _token) {
                if (!inlayHintsEnabled) return [];
                const diagnostics = store.get(document.uri.toString());
                if (!diagnostics) return [];

                // Group diagnostics by position to avoid stacking hints
                const byPosition = new Map<string, { diag: typeof diagnostics[number]; idx: number; fmt: { label: string; applyValue: string } }[]>();
                for (let i = 0; i < diagnostics.length; i++) {
                    const d = diagnostics[i]!;
                    if (d.confidence !== undefined && d.confidence >= HINT_CONFIDENCE_FLOOR
                        && d.suggestions && d.suggestions.length > 0) {
                        const fmt = formatInlayLabel(d, document);
                        if (!fmt) continue;
                        const key = `${d.range.end.line}:${d.range.end.character}`;
                        const group = byPosition.get(key);
                        const entry = { diag: d, idx: i, fmt };
                        if (group) {
                            group.push(entry);
                        } else {
                            byPosition.set(key, [entry]);
                        }
                    }
                }

                const hints: vscode.InlayHint[] = [];
                for (const group of byPosition.values()) {
                    if (group.length === 0) continue;
                    const first = group[0]!;
                    let label: string;
                    let tooltip: string;
                    if (group.length === 1) {
                        label = first.fmt.label;
                        tooltip = `Accept suggestion: ${first.fmt.applyValue || '(remove)'}`;
                    } else {
                        label = `${first.fmt.label} (+${group.length - 1} more)`;
                        tooltip = group
                            .map((e, i) => `${i + 1}. ${e.diag.message}: ${e.fmt.applyValue || '(remove)'}`)
                            .join('\n');
                    }
                    const hint = new vscode.InlayHint(
                        first.diag.range.end,
                        [
                            {
                                value: label,
                                command: commandLink(COMMANDS.applyFix, 'Apply Fix', diagId(first.idx), first.fmt.applyValue)
                            }
                        ],
                        vscode.InlayHintKind.Type
                    );
                    hint.tooltip = tooltip;
                    hints.push(hint);
                }
                // Whether a hint appears depends on four things that are
                // invisible from the editor: the provider firing at all, the
                // document having diagnostics, those diagnostics clearing the
                // confidence floor, and the label formatter returning one. A
                // count of each is what tells the four apart without guessing.
                log.debug('provideInlayHints', {
                    language: document.languageId,
                    diagnostics: diagnostics.length,
                    aboveConfidenceFloor: diagnostics.filter(
                        d => d.confidence !== undefined && d.confidence >= HINT_CONFIDENCE_FLOOR
                    ).length,
                    hints: hints.length,
                });
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
                if (!inlayHintsEnabled) return [];
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const re = /\\begin\{([^}]+)\}/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const envName = m[1]!;
                    if (BUILTIN_SKIP_ENVS.has(envName) || PROSE_ENVS.has(envName) || configState.skipEnvironments.has(envName) || configState.proseEnvironments.has(envName)) continue;
                    const pos = document.positionAt(m.index + m[0].length);
                    const hint = new vscode.InlayHint(
                        pos,
                        [
                            {
                                value: ' \u2298 skip',
                                command: commandLink(COMMANDS.skipLatexEnv, 'Skip checking this environment', envName)
                            },
                            {
                                value: ' | hide hint',
                                command: commandLink(COMMANDS.hideLatexEnvHint, 'Hide this hint (keep checking)', envName)
                            }
                        ],
                        vscode.InlayHintKind.Parameter
                    );
                    hint.tooltip = `"skip" adds to skip_environments, "hide hint" adds to prose_environments`;
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
                if (!inlayHintsEnabled) return [];
                const diagnostics = store.get(document.uri.toString());
                if (!diagnostics || diagnostics.length === 0) return [];
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const seen = new Set<string>();
                const re = /\\([a-zA-Z]+)\{/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const cmdName = m[1]!;
                    if (
                        BUILTIN_SKIP_COMMANDS.has(cmdName) ||
                        configState.skipCommands.has(cmdName) ||
                        PROSE_COMMANDS.has(cmdName)
                    ) continue;
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
                            command: commandLink(COMMANDS.skipLatexCommand, 'Skip this LaTeX command', cmdName)
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
        supportedLanguageSelector(),
        {
            provideInlineCompletionItems(document, position, _context, _token) {
                const diagnostics = store.get(document.uri.toString());
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
        supportedLanguageSelector(),
        {
            provideCodeActions(document, range, context) {
                const diagnostics = store.get(document.uri.toString());
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

                    // Two groups, emitted in this order. The always-present
                    // actions come first so they keep a stable position: a
                    // misspelling can carry twenty suggestions, and listing
                    // those first pushes "Add to dictionary" — the one most
                    // often reached for — off the bottom of the lightbulb.
                    const singleChoice: vscode.CodeAction[] = [];
                    const replacements: vscode.CodeAction[] = [];

                    const ruleId = ruleIdOf(diag, '');
                    const word = isSpellingRule(ruleId)
                        ? getDiagnosticWord(document, diag)
                        : null;

                    // A language nothing could check. The modal is asked at
                    // most once and never again after a refusal, so this is
                    // where the offer stays reachable afterwards -- it costs
                    // nothing until someone opens the lightbulb.
                    if (ruleId === 'languagecheck.no-provider' && extDiag.packInstallable) {
                        const tag = extDiag.language ?? '';
                        const installAction = new vscode.CodeAction(
                            vscode.l10n.t('Install the {0} dictionary', tag),
                            vscode.CodeActionKind.QuickFix
                        );
                        installAction.command = commandLink(COMMANDS.installPack, vscode.l10n.t('Install dictionary'), tag);
                        installAction.diagnostics = [diag];
                        singleChoice.push(installAction);
                    }

                    // Add "Add to Dictionary" action for spelling rules
                    if (word !== null) {
                        const dictAction = new vscode.CodeAction(
                            `Add "${word}" to dictionary`,
                            vscode.CodeActionKind.QuickFix
                        );
                        dictAction.command = commandLink(COMMANDS.addToDictionary, 'Add to Dictionary', word);
                        dictAction.diagnostics = [diag];
                        singleChoice.push(dictAction);
                    }

                    // Add "Ignore" action
                    const ignoreAction = new vscode.CodeAction(
                        'Ignore this issue',
                        vscode.CodeActionKind.QuickFix
                    );
                    ignoreAction.command = commandLink(COMMANDS.ignoreDiagnostic, 'Ignore', diagId(diagIndex));
                    ignoreAction.diagnostics = [diag];
                    singleChoice.push(ignoreAction);

                    // Add "Deactivate rule" action
                    if (ruleId) {
                        const deactivateAction = new vscode.CodeAction(
                            vscode.l10n.t('Deactivate rule "{0}"', ruleId),
                            vscode.CodeActionKind.QuickFix
                        );
                        deactivateAction.command = commandLink(COMMANDS.deactivateRule, 'Deactivate rule', ruleId);
                        deactivateAction.diagnostics = [diag];
                        singleChoice.push(deactivateAction);
                    }

                    // Add a quickfix for each suggestion
                    if (extDiag.suggestions) {
                        for (const suggestion of extDiag.suggestions) {
                            const inserted = insertedText(suggestion);
                            const isRemove = suggestion === '';
                            const label = isRemove
                                ? 'Fix: Remove text'
                                : inserted !== null
                                    ? `Fix: Insert "${inserted}"`
                                    : `Fix: "${suggestion}"`;
                            const fix = new vscode.CodeAction(
                                label,
                                vscode.CodeActionKind.QuickFix
                            );
                            fix.edit = new vscode.WorkspaceEdit();
                            addSuggestionEdit(fix.edit, document.uri, diag.range, suggestion);
                            fix.diagnostics = [diag];
                            fix.isPreferred = extDiag.suggestions.indexOf(suggestion) === 0;
                            replacements.push(fix);
                        }
                    }

                    // "Fix all" bulk actions (only when first suggestion exists).
                    // They apply the top suggestion, so they stay next to the
                    // list that shows what that suggestion is.
                    if (word !== null && extDiag.suggestions && extDiag.suggestions.length > 0) {
                        const replacement = extDiag.suggestions[0]!;
                        const uri = document.uri.toString();

                        // Count matching spelling diagnostics in this file
                        const fileCount = diagnostics.filter(d => isSpellingOf(document, d, word)).length;

                        if (fileCount >= 2) {
                            const fixFileAction = new vscode.CodeAction(
                                vscode.l10n.t('Fix all "{0}" in this file', word),
                                vscode.CodeActionKind.QuickFix
                            );
                            fixFileAction.command = commandLink(COMMANDS.fixAllSpellingInFile, 'Fix all in file', uri, word, replacement);
                            fixFileAction.diagnostics = [diag];
                            replacements.push(fixFileAction);
                        }

                        // Count matching spelling diagnostics across workspace
                        let workspaceCount = 0;
                        for (const [entryUri, entryDiags] of store) {
                            const entryDoc = findOpenDocument(entryUri);
                            if (!entryDoc) continue;
                            workspaceCount += entryDiags.filter(d => isSpellingOf(entryDoc, d, word)).length;
                        }

                        if (workspaceCount >= 2) {
                            const fixWsAction = new vscode.CodeAction(
                                vscode.l10n.t('Fix all "{0}" in workspace', word),
                                vscode.CodeActionKind.QuickFix
                            );
                            fixWsAction.command = commandLink(COMMANDS.fixAllSpellingInWorkspace, 'Fix all in workspace', word, replacement);
                            fixWsAction.diagnostics = [diag];
                            replacements.push(fixWsAction);
                        }
                    }

                    actions.push(...singleChoice, ...replacements);
                }

                // Offered once for the whole selection, not once per
                // diagnostic. "Ignore this issue" is keyed on one finding's
                // message, so a phrase three engines all dislike takes three
                // trips through the lightbulb -- and the second and third
                // only appear once the one above has gone.
                const here = spanned(
                    {
                        start: document.offsetAt(range.start),
                        end: document.offsetAt(range.end),
                    },
                    diagnostics.map(d => ({
                        start: document.offsetAt(d.range.start),
                        end: document.offsetAt(d.range.end),
                        code: ruleIdOf(d, undefined),
                    })),
                );
                if (here.length > 1 && enginesBehind(here.map(d => d.code)).size > 0) {
                    const silenceAll = new vscode.CodeAction(
                        vscode.l10n.t('Ignore all {0} issues here', here.length),
                        vscode.CodeActionKind.QuickFix,
                    );
                    silenceAll.command = commandLink(
                        COMMANDS.ignoreSelection,
                        'Ignore all issues here',
                        document.uri.toString(),
                        document.offsetAt(range.start),
                        document.offsetAt(range.end),
                    );
                    actions.push(silenceAll);
                }

                return actions;
            }
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ));

    context.subscriptions.push(registerCommand(COMMANDS.downloadBinary, async () => {
        const result = await downloadWithProgress(context);
        if (result.ok) {
            core.restart();
        } else {
            onDownloadFailedChoice(await downloadFailedMessage(result.error));
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.toggleInlayHints, () => {
        inlayHintsEnabled = !inlayHintsEnabled;
        inlayHintEmitter.fire();
        vscode.window.showInformationMessage(inlayHintsEnabled
            ? vscode.l10n.t('Language Check inlay hints enabled')
            : vscode.l10n.t('Language Check inlay hints disabled'));
    }));

    context.subscriptions.push(registerCommand(COMMANDS.toggleCheckTrigger, async () => {
        const current = checkTrigger();
        const next = current === 'onChange' ? 'onSave' : 'onChange';
        await updateSetting('check.trigger', next, vscode.ConfigurationTarget.Workspace);
        const label = next === 'onSave'
            ? vscode.l10n.t('Switched to check on save')
            : vscode.l10n.t('Switched to check on change');
        vscode.window.showInformationMessage(label);
    }));

    context.subscriptions.push(registerCommand(COMMANDS.managePlugins, async () => {
        // `?? []` as well as the manifest default: a `null` written into
        // settings.json by hand comes back as null, not as the default.
        const plugins = getSetting('plugins') ?? [];

        if (plugins.length === 0) {
            vscode.window.showInformationMessage(
                vscode.l10n.t('No plugins configured. Add plugins in settings (languageCheck.plugins).')
            );
            return;
        }

        const items = plugins.map((p, i) => {
            const name = p.name ?? path.basename(p.path, '.wasm');
            const enabled = p.enabled !== false;
            return {
                label: name,
                description: enabled
                    ? vscode.l10n.t('{0} (enabled)', p.path)
                    : vscode.l10n.t('{0} (disabled)', p.path),
                picked: enabled,
                index: i,
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: vscode.l10n.t('Select plugins to enable/disable'),
        });

        if (!selected) return;

        const selectedIndices = new Set(selected.map(s => s.index));
        const updated = plugins.map((p, i) => ({ ...p, enabled: selectedIndices.has(i) }));
        await updateSetting('plugins', updated, vscode.ConfigurationTarget.Workspace);

        for (const item of items) {
            const nowEnabled = selectedIndices.has(item.index);
            const wasEnabled = plugins[item.index]?.enabled !== false;
            if (nowEnabled !== wasEnabled) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Plugin "{0}" {1}', item.label, nowEnabled ? 'enabled' : 'disabled')
                );
            }
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.restartLanguageServer, () => {
        log.info('Restarting language server');
        inspectorLog.push('info', 'restartServer', 'Restarting language server');
        core.restart();
        vscode.window.showInformationMessage(vscode.l10n.t('Language Check server restarted'));
    }));

    context.subscriptions.push(registerCommand(COMMANDS.restartLTDocker, () =>
        restartLanguageToolDocker(document => checker.check(document))));

    context.subscriptions.push(registerCommand(COMMANDS.ignoreDiagnostic, async (diagnosticId: string) => {
        await ignoreDiagnostic(diagnosticId);
    }));

    /**
     * Silence every engine over one span.
     *
     * Each finding is fingerprinted separately, because that is what the
     * ignore store holds and what makes the suppression survive a reload. The
     * span is only how they are chosen.
     *
     * Called with no arguments from the palette, where the editor's own
     * selection is the span.
     */
    context.subscriptions.push(registerCommand(COMMANDS.ignoreSelection,
        async (uriText?: string, startOffset?: number, endOffset?: number) => {
            const editor = uriText === undefined
                ? vscode.window.activeTextEditor
                : vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uriText)
                    ?? vscode.window.activeTextEditor;
            if (!editor || !core.client) return;

            const document = editor.document;
            const uri = document.uri.toString();
            const diagnostics = store.get(uri);
            if (!diagnostics || diagnostics.length === 0) return;

            const start = startOffset ?? document.offsetAt(editor.selection.start);
            const end = endOffset ?? document.offsetAt(editor.selection.end);
            const chosen = spanned(
                { start, end },
                diagnostics.map((d, index) => ({
                    start: document.offsetAt(d.range.start),
                    end: document.offsetAt(d.range.end),
                    index,
                })),
            );
            if (chosen.length === 0) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Nothing to ignore in the selection.'),
                );
                return;
            }

            const text = document.getText();
            for (const { index } of chosen) {
                const diagnostic = diagnostics[index];
                if (!diagnostic) continue;
                await core.client.sendRequest(ignoreRequest(diagnostic, document, text));
            }

            const silenced = new Set(chosen.map(c => c.index));
            const remaining = diagnostics.filter((_, index) => !silenced.has(index));
            store.write(uri, document.uri, remaining);
            store.notify();
            inspectorLog.push(
                'info',
                'ignoreSelection',
                `Ignoring ${chosen.length} issue(s) over the selection`,
            );
        },
    ));

    context.subscriptions.push(registerCommand(COMMANDS.fixAllSpellingInFile, async (uri: string, word: string, replacement: string) => {
        const diagnostics = store.get(uri);
        if (!diagnostics) return;

        const document = findOpenDocument(uri);
        if (!document) return;

        const matching = diagnostics.filter(d => isSpellingOf(document, d, word));
        if (matching.length === 0) return;

        const edit = new vscode.WorkspaceEdit();
        for (const d of matching) {
            edit.replace(document.uri, d.range, replacement);
        }
        await vscode.workspace.applyEdit(edit);

        // Optimistic removal
        const remaining = diagnostics.filter(d => !matching.includes(d));
        store.write(uri, document.uri, remaining);
        store.notify();

        // Re-check for consistency
        await checker.check(document);
    }));

    context.subscriptions.push(registerCommand(COMMANDS.fixAllSpellingInWorkspace, async (word: string, replacement: string) => {
        const edit = new vscode.WorkspaceEdit();
        const affectedUris: string[] = [];

        for (const [uri, diagnostics] of store) {
            const document = findOpenDocument(uri);
            if (!document) continue;

            const matching = diagnostics.filter(d => isSpellingOf(document, d, word));
            if (matching.length === 0) continue;

            for (const d of matching) {
                edit.replace(document.uri, d.range, replacement);
            }

            // Optimistic removal
            const remaining = diagnostics.filter(d => !matching.includes(d));
            store.write(uri, document.uri, remaining);
            affectedUris.push(uri);
        }

        if (affectedUris.length === 0) return;

        await vscode.workspace.applyEdit(edit);
        store.notify();

        // Re-check all affected files
        for (const uri of affectedUris) {
            const document = findOpenDocument(uri);
            if (document) {
                await checker.check(document);
            }
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.toggleTrace, () => {
        const enabled = core.traceLogger.toggle();
        vscode.window.showInformationMessage(
            vscode.l10n.t('Protobuf trace {0}', enabled ? vscode.l10n.t('enabled') : vscode.l10n.t('disabled'))
        );
    }));

    context.subscriptions.push(registerCommand(COMMANDS.showTrace, () => {
        core.traceLogger.show();
    }));

    context.subscriptions.push(registerCommand(COMMANDS.switchCore, async () => {
        const channels: { label: string; description: string; channel: SettingValue<'core.channel'> }[] = [
            { label: vscode.l10n.t('Stable'), description: vscode.l10n.t('Production release'), channel: 'stable' },
            { label: vscode.l10n.t('Canary'), description: vscode.l10n.t('Pre-release with latest features'), channel: 'canary' },
            { label: vscode.l10n.t('Dev'), description: vscode.l10n.t('Development build (debug symbols)'), channel: 'dev' },
        ];
        // Only offered on a development host, where rust-core/target/debug exists.
        if (isDev) {
            channels.push({
                label: vscode.l10n.t('Debug'),
                description: vscode.l10n.t('Local cargo debug build'),
                channel: 'debug',
            });
        }
        const selected = await vscode.window.showQuickPick(channels, {
            placeHolder: vscode.l10n.t('Select core binary channel'),
        });
        if (!selected) return;

        await updateSetting('core.channel', selected.channel, vscode.ConfigurationTarget.Global);

        core.restart(selected.channel);

        vscode.window.showInformationMessage(
            vscode.l10n.t('Switched to {0} core', selected.label)
        );
    }));

    context.subscriptions.push(registerCommand(COMMANDS.installPack, async (language: string) => {
        await installDictionaryPack(context, language);
    }));

    context.subscriptions.push(registerCommand(COMMANDS.addToDictionary, async (word: string) => {
        if (!core.client) return;
        sendSpeedFixLoading(true);
        const t0 = performance.now();
        log.debug('addToDictionary', { word });
        inspectorLog.push('info', 'addToDictionary', `Sending request for "${word}"`);
        try {
            const response = await core.client.sendRequest({
                addDictionaryWord: { word }
            });
            const rpcMs = performance.now() - t0;
            if (response.ok) {
                inspectorLog.push('info', 'addToDictionary', `Server confirmed "${word}"`, { durationMs: rpcMs });
                // Suppress this word in any in-flight check results until the re-check completes
                const wordLower = word.toLowerCase();
                suppression.words.add(wordLower);
                // Optimistic removal: remove all spelling diagnostics for this word immediately
                const editor = findEditorWithDiagnostics();
                let removedCount = 0;
                if (editor) {
                    const uri = editor.document.uri.toString();
                    const diagnostics = store.get(uri);
                    if (diagnostics) {
                        const remaining = diagnostics.filter(d => {
                            const diagWord = editor.document.getText(d.range);
                            const isSpelling = isSpellingRule(ruleIdOf(d, ''));
                            if (isSpelling && diagWord.toLowerCase() === wordLower) {
                                removedCount++;
                                return false;
                            }
                            return true;
                        });
                        store.write(uri, editor.document.uri, remaining);
                        store.notify();
                    }
                    inspectorLog.push('debug', 'addToDictionary', `Removed ${removedCount} diagnostics, re-checking`);
                    // Full re-check for consistency (dictionary is now server-side updated)
                    await checker.check(editor.document);
                    suppression.words.delete(wordLower);
                }
                const extra = removedCount > 1 ? vscode.l10n.t(' ({0} occurrences resolved)', removedCount) : '';
                vscode.window.showInformationMessage(vscode.l10n.t('Added "{0}" to dictionary', word) + extra);
                inspectorLog.push('info', 'addToDictionary', `Done`, { durationMs: performance.now() - t0 });
            } else if (response.error) {
                inspectorLog.push('error', 'addToDictionary', `Server error: ${response.error.message}`, { durationMs: rpcMs });
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', response.error.message ?? ''));
            }
        } catch (err) {
            const errStr = String(err);
            inspectorLog.push('error', 'addToDictionary', errStr, { durationMs: performance.now() - t0 });
            log.error('addToDictionary failed', { word, error: errStr });
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', errStr));
        } finally {
            sendSpeedFixLoading(false);
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.deactivateRule, async (ruleId: string) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const targetUri = await resolveConfigForEdit(workspaceFolder);

        try {
            const edit = deactivateRule(await readConfigText(targetUri), ruleId);
            const alreadyDeactivated = edit.alreadyDeactivated;
            if (!alreadyDeactivated) {
                await writeConfigText(targetUri, edit.content);
            }

            // Suppress this rule in any in-flight check results
            suppression.rules.add(ruleId);

            // Immediately remove matching diagnostics from all open documents
            for (const [uri, diagnostics] of store) {
                const remaining = diagnostics.filter(d => {
                    return ruleIdOf(d, '') !== ruleId;
                });
                if (remaining.length !== diagnostics.length) {
                    store.write(uri, vscode.Uri.parse(uri), remaining);
                }
            }
            store.notify();

            vscode.window.showInformationMessage(
                alreadyDeactivated
                    ? vscode.l10n.t('Rule "{0}" is already deactivated in project config', ruleId)
                    : vscode.l10n.t('Rule "{0}" deactivated in project config', ruleId)
            );

            // The diagnostics for this rule are already gone, filtered out
            // just above. The core still has to learn about the new config,
            // but nothing on screen is waiting on it -- and re-checking here
            // would clear every diagnostic in the window to arrive back at
            // what is already drawn. The file watcher reaches the same
            // conclusion for a config edited by hand.
            await core.initialize();
            suppression.rules.delete(ruleId);
        } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to deactivate rule: {0}', String(err)));
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.applyFix, async (diagnosticId: string, suggestion: string) => {
        await applyFix(diagnosticId, suggestion);
    }));

    context.subscriptions.push(registerCommand(COMMANDS.selectLanguage, async () => {
        const languages = [
            { label: 'en-US', description: vscode.l10n.t('English (US)') },
            { label: 'en-GB', description: vscode.l10n.t('English (UK)') },
            { label: 'de-DE', description: vscode.l10n.t('German (Germany)') },
            { label: 'de-AT', description: vscode.l10n.t('German (Austria)') },
            { label: 'fr', description: vscode.l10n.t('French') },
            { label: 'es', description: vscode.l10n.t('Spanish') },
            { label: 'pt-BR', description: vscode.l10n.t('Portuguese (Brazil)') },
            { label: 'pt-PT', description: vscode.l10n.t('Portuguese (Portugal)') },
            { label: 'it', description: vscode.l10n.t('Italian') },
            { label: 'nl', description: vscode.l10n.t('Dutch') },
            { label: 'pl', description: vscode.l10n.t('Polish') },
            { label: 'ru', description: vscode.l10n.t('Russian') },
            { label: 'uk', description: vscode.l10n.t('Ukrainian') },
            { label: 'ja', description: vscode.l10n.t('Japanese') },
            { label: 'zh', description: vscode.l10n.t('Chinese') },
            { label: 'ko', description: vscode.l10n.t('Korean') },
            { label: 'ar', description: vscode.l10n.t('Arabic') },
            { label: 'sv', description: vscode.l10n.t('Swedish') },
            { label: 'da', description: vscode.l10n.t('Danish') },
            { label: 'fi', description: vscode.l10n.t('Finnish') },
            { label: 'cs', description: vscode.l10n.t('Czech') },
            { label: 'ro', description: vscode.l10n.t('Romanian') },
        ];
        const selected = await vscode.window.showQuickPick(languages, {
            placeHolder: vscode.l10n.t('Select spell-check language')
        });
        if (!selected) return;

        const workspaceFolder = workspaceFolderOrWarn();
        if (!workspaceFolder) return;

        const targetUri = await resolveConfigForEdit(workspaceFolder);
        try {
            const content = setSpellLanguage(await readConfigText(targetUri), selected.label);
            await writeConfigText(targetUri, content);
            statusBars.setLanguage(selected.label);
            vscode.window.showInformationMessage(
                vscode.l10n.t('Spell-check language set to "{0}". Reloading...', selected.label)
            );
            await reinitializeAndRecheck();
        } catch (err) {
            showConfigUpdateError(err);
        }
    }));

    context.subscriptions.push(registerCommand(COMMANDS.manageEngines, async () => {
        const workspaceFolder = workspaceFolderOrWarn();
        if (!workspaceFolder) return;

        const targetUri = await resolveConfigForEdit(workspaceFolder);
        let content = await readConfigText(targetUri);

        // Determine current language to show language-support hints
        const spellLang = spellLanguageOf(content);
        const isEnglish = spellLang.startsWith('en');

        // Engine definitions: key, label, description, language constraint
        const engines: { key: string; label: string; desc: string; englishOnly: boolean }[] = [
            { key: 'harper', label: 'Harper', desc: vscode.l10n.t('Fast, local grammar/spelling'), englishOnly: true },
            { key: 'languagetool', label: 'LanguageTool', desc: vscode.l10n.t('Server-based deep analysis'), englishOnly: false },
            { key: 'vale', label: 'Vale', desc: vscode.l10n.t('Style linting with plugins'), englishOnly: false },
            { key: 'proselint', label: 'Proselint', desc: vscode.l10n.t('English prose best practices'), englishOnly: true },
        ];

        // Build multi-select items with current state
        // Supports both bool shorthand (`harper: true`) and nested (`harper:\n  enabled: true`)
        const items: (vscode.QuickPickItem & { engineKey: string })[] = engines
            .map(e => {
                // harper defaults to true, others to false
                const isOn = engineEnabled(content, e.key, e.key === 'harper');
                const langNote = e.englishOnly && !isEnglish
                    ? ` $(warning) ${vscode.l10n.t('English only')}`
                    : '';
                return {
                    label: e.label,
                    description: `${e.desc}${langNote}`,
                    picked: isOn,
                    engineKey: e.key,
                };
            });

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: vscode.l10n.t('Select engines to enable (language: {0})', spellLang),
        });
        if (!selected) return;

        const enabledKeys = new Set(selected.map(s => s.engineKey));

        try {
            for (const e of engines) {
                content = setEngineEnabled(content, e.key, enabledKeys.has(e.key));
            }

            await writeConfigText(targetUri, content);
            const names = selected.map(s => s.label).join(', ');
            vscode.window.showInformationMessage(
                vscode.l10n.t('Engines updated: {0}. Reloading...', names)
            );
            await reinitializeAndRecheck();
        } catch (err) {
            showConfigUpdateError(err);
        }
    }));

    /**
     * Add a name to one of the `languages.latex` lists, then refresh the hints.
     *
     * Behind the three LaTeX inlay-hint actions. The set is updated here as
     * well as in the file, so the hint goes before the config watcher has
     * re-read anything.
     */
    const appendToLatexList = async (list: LatexList, name: string, message: string, userSet: Set<string>) => {
        const workspaceFolder = workspaceFolderOrWarn();
        if (!workspaceFolder) return;

        const targetUri = await resolveConfigForEdit(workspaceFolder);
        try {
            await writeConfigText(targetUri, addLatexListEntry(await readConfigText(targetUri), list, name));
            vscode.window.showInformationMessage(message);
            userSet.add(name);
            inlayHintEmitter.fire();
        } catch (err) {
            showConfigUpdateError(err);
        }
    };

    context.subscriptions.push(registerCommand(COMMANDS.skipLatexEnv, (envName: string) =>
        appendToLatexList('skip_environments', envName,
            vscode.l10n.t('Added "{0}" to skip list. Rechecking...', envName), configState.skipEnvironments)));

    context.subscriptions.push(registerCommand(COMMANDS.hideLatexEnvHint, (envName: string) =>
        appendToLatexList('prose_environments', envName,
            vscode.l10n.t('Hint hidden for "{0}". Checking continues.', envName), configState.proseEnvironments)));

    context.subscriptions.push(registerCommand(COMMANDS.skipLatexCommand, (cmdName: string) =>
        appendToLatexList('skip_commands', cmdName,
            vscode.l10n.t('Added "{0}" to skip_commands. Rechecking...', cmdName), configState.skipCommands)));

    context.subscriptions.push(registerCommand(COMMANDS.checkDocument, async (): Promise<CheckOutcome | undefined> => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;
        const result = await checker.check(editor.document);
        // Show feedback when invoked manually
        if (result === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No language issues found.'));
        } else if (result > 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('Found {0} issue(s).', result));
        }
        // Returned so a caller can see what the check did. A command's return
        // value reaches executeCommand, which is how the end-to-end tests
        // assert that a reload reused the stored result.
        return { diagnostics: result, servedFromCache: results.servedFromCache };
    }));

    context.subscriptions.push(registerCommand(COMMANDS.checkWorkspace, async () => {
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
                await checker.check(document);
            }
        });
    }));

    context.subscriptions.push(registerCommand(COMMANDS.openSpeedFix, () => {
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

        speedFixPanel.webview.html = webviewHtml(speedFixPanel.webview, context.extensionPath, { script: 'index', title: 'SpeedFix' });

        speedFixPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
            switch (message.type) {
                case 'ready': {
                    const hpm = getSetting('performance.highPerformanceMode');
                    speedFixPanel?.webview.postMessage({ type: 'setLowResource', payload: hpm });
                    speedFixPanel?.webview.postMessage({ type: 'setScope', payload: speedFixScope });
                    // Track which file SpeedFix is targeting
                    speedFixTargetUri = (originEditor ?? vscode.window.activeTextEditor)?.document.uri.toString() ?? null;
                    // If we already have diagnostics, send them immediately
                    updateSpeedFixDiagnostics();
                    // If no diagnostics exist yet, auto-run a check using the
                    // editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !store.has(editorForCheck.document.uri.toString())) {
                        sendSpeedFixLoading(true);
                        checker.check(editorForCheck.document).then(() => {
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
                    await executeCommand(COMMANDS.addToDictionary, message.payload.word);
                    speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
                    break;
                case 'goToLocation': {
                    const editor = findEditorWithDiagnostics();
                    if (!editor) break;
                    const diagnostics = store.get(editor.document.uri.toString());
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
                    const editor = findEditorWithDiagnostics() ?? vscode.window.activeTextEditor;
                    if (editor) {
                        sendSpeedFixLoading(true);
                        await checker.check(editor.document);
                        sendSpeedFixLoading(false);
                    }
                    break;
                }
                case 'setScope':
                    speedFixScope = message.payload;
                    updateSpeedFixDiagnostics();
                    break;
                case 'close':
                    speedFixPanel?.dispose();
                    break;
            }
        }, undefined, context.subscriptions);

        speedFixPanel.onDidDispose(() => {
            speedFixPanel = null;
            speedFixTargetUri = null;
        }, null, context.subscriptions);
    }));

    context.subscriptions.push(registerCommand(COMMANDS.openInspector, () => {
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

        inspectorLog.attach(inspectorPanel.webview);
        inspectorPanel.webview.html = webviewHtml(inspectorPanel.webview, context.extensionPath, { script: 'inspector', title: 'Inspector' });

        inspectorPanel.webview.onDidReceiveMessage(async (message: InspectorToExtensionMessage) => {
            switch (message.type) {
                case 'inspectorReady': {
                    // Use the editor captured before the panel stole focus.
                    const editorForCheck = originEditor ?? vscode.window.activeTextEditor;
                    if (editorForCheck && !store.has(editorForCheck.document.uri.toString())) {
                        await checker.check(editorForCheck.document);
                    }
                    await updateInspectorData();
                    inspectorPanel?.webview.postMessage({ type: 'setDockerAvailable', payload: hasDockerCompose() });
                    const extVersion = (context.extension.packageJSON as { version?: string }).version ?? 'unknown';
                    inspectorPanel?.webview.postMessage({ type: 'setExtensionVersion', payload: extVersion });
                    break;
                }
                case 'highlightRange': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const byteToChar = byteToCharConverter(editor.document.getText());
                        const start = editor.document.positionAt(byteToChar(message.payload.startByte));
                        const end = editor.document.positionAt(byteToChar(message.payload.endByte));
                        editor.selection = new vscode.Selection(start, end);
                        editor.revealRange(new vscode.Range(start, end));
                    }
                    break;
                }
                case 'healthCheckLT': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await checker.check(editor.document);
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
        }, undefined, context.subscriptions);

        inspectorPanel.onDidDispose(() => {
            inspectorPanel = null;
            inspectorLog.detach();
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
        if (!isCheckable(document)) return;
        const isVisible = vscode.window.visibleTextEditors.some(
            e => e.document.uri.toString() === document.uri.toString()
        );
        if (!isVisible) return;
        checkIfUnchecked(document);
    }));

    // Also check when the active editor changes (e.g. switching tabs)
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return;
        checkIfUnchecked(editor.document);
    }));

    // ── Initial check on reload ──
    // An editor open before the extension activated raises no open event, so
    // it is checked here. `core.boot()` does the same once the core is ready;
    // whichever runs second finds the document already in the store and
    // does nothing, so the two cannot double-check it.
    checkVisibleUnchecked();

    // ── Check-on-change with debounce ──
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isCheckable(event.document)) return;
        const trigger = checkTrigger();
        if (trigger !== 'onChange') return;

        const doc = event.document;
        debouncer.schedule(doc.uri.toString(), configState.debounceMs, () => {
            checker.check(doc);
        });
    }));

    // Always re-check on save (regardless of trigger mode)
    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (SUPPORTED_LANGUAGES.includes(document.languageId)) {
            // Cancel any pending debounce for this doc since we're checking now
            debouncer.cancel(document.uri.toString());
            await checker.check(document);
            await updateInspectorData();
        }
    });

    // Watch .languagecheck config files for any change that affects results
    /**
     * Settings the core is told about at Initialize, and only then.
     *
     * Changing one of these used to do nothing at all until the window was
     * reloaded: `.languagecheck.yaml` had a file watcher, and VS Code's own
     * settings had nothing. Switching the bundled wordlists off in the
     * Settings UI left every one of their words still accepted, with no
     * indication that the setting had not taken.
     */
    const CORE_SETTINGS = ([
        'dictionaries.bundled',
        'dictionaries.disabled',
        'dictionaries.paths',
        'names.enabled',
        'workspace.indexOnOpen',
        'workspace.dbPath',
    ] as const).map(settingId);

    /** Settings that decide which binary runs, so the process has to be replaced. */
    const CORE_PROCESS_SETTINGS = (['core.binaryPath', 'core.channel'] as const).map(settingId);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        if (CORE_PROCESS_SETTINGS.some(key => event.affectsConfiguration(key))) {
            log.info('Core binary setting changed, restarting');
            await core.boot();
            return;
        }
        if (CORE_SETTINGS.some(key => event.affectsConfiguration(key))) {
            log.info('Core setting changed, reinitializing');
            await refreshDictionaryWatchers();
            await reinitializeAndRecheck();
        }
        // Everything else -- the check trigger, the inlay hints, the panel --
        // is read where it is used, so a change takes effect on its own.
    }));

    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.languagecheck.{yaml,yml,json}');
    const checkConfigChange = async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        // Not readFirstConfig: this try also covers everything done with the
        // text below, and an exception there moves on to the next name.
        for (const name of CONFIG_FILE_NAMES) {
            const uri = vscode.Uri.joinPath(folder.uri, name);
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

                const currentLang = spellLanguageOf(raw);
                statusBars.setLanguage(currentLang);

                // Any edit, not only the spell language: the rest of the file
                // decides the result just as much, and what is on screen has to
                // match the config that produced it.
                //
                // Except when the only thing that changed is a rule being
                // silenced, which the core applies after the engines have run.
                // Then the findings on screen are already the right ones minus
                // a filter, and re-checking would blank the file and fill it
                // back in to reach the answer it is holding.
                const previous = configState.seen;
                const change = previous.state === 'present'
                    ? classifyConfigChange(previous.text, raw)
                    : { kind: 'none' as const, newlyOff: new Set<string>() };
                const changed = previous.state === 'absent'
                    || (previous.state === 'present' && raw !== previous.text);
                configState.seen = { state: 'present', text: raw };

                configState.apply(raw);
                inlayHintEmitter.fire();
                if (changed && change.kind === 'subtractive') {
                    await applySilencedRules(change.newlyOff);
                    configStatusView?.refresh();
                } else if (changed) {
                    // Before the recheck: the config may have named a
                    // different wordlist, and the new one has to be watched
                    // from now on.
                    await refreshDictionaryWatchers();
                    await reinitializeAndRecheck();
                    // A change from outside the editor -- another window, a
                    // branch switch -- moves the text without a keystroke to
                    // fire the usual trigger.
                    configStatusView?.refresh();
                }
                return;
            } catch { /* not found, try next */ }
        }

        // No config file, under any of its names. Deleting one is a config
        // change like any other -- the core falls back to its defaults, and
        // the parsed settings this file fed have to go with it, or an inlay
        // hint keeps skipping a LaTeX environment the config no longer names.
        const hadOne = configState.seen.state === 'present';
        configState.seen = { state: 'absent' };
        statusBars.setLanguage('en-US');
        configState.reset();
        inlayHintEmitter.fire();
        if (hadOne) {
            await reinitializeAndRecheck();
        }
    };
    /**
     * Watchers over the wordlists the config names, rebuilt when it changes.
     *
     * Adding a path to the config reloaded the core, because the config file
     * is watched -- but editing the wordlist it points at did nothing until
     * the next reload. Editing a wordlist is the more ordinary of the two, so
     * the feature appeared to work once and then stop.
     *
     * Watched individually rather than by a broad glob: these are arbitrary
     * paths a user chose, and a pattern wide enough to cover them would fire
     * on files that have nothing to do with this extension.
     */
    let dictionaryWatchers: vscode.FileSystemWatcher[] = [];

    /**
     * Where SLS schemas live, watched for the same reason as the wordlists.
     *
     * The core reads this directory once, at Initialize. Editing a schema did
     * nothing until the next reload -- and a schema is a thing under active
     * development, since writing one is an iterative business of running the
     * checker and adjusting the patterns.
     */
    const SCHEMA_DIR_PATTERN = '.langcheck/schemas/**/*';

    /**
     * What each watched wordlist held last time it was read.
     *
     * Kept so a change can be classified: adding a word can only remove
     * spelling findings, and removing one needs the check because the finding
     * was dropped inside the core and never reached the editor.
     */
    const wordlistContents = new Map<string, string>();

    const readWordlist = async (uri: vscode.Uri): Promise<string> => {
        try {
            return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch {
            return '';
        }
    };

    /**
     * Apply a wordlist edit that only added words.
     *
     * The accepted words' findings are dropped in place, so the file does not
     * blank and fill back in to arrive at what is already on screen minus one
     * word. The re-check still runs, because the core also accepts affixed
     * forms of a dictionary word through the morphology analyser and this
     * only knows the exact ones -- but it runs without clearing first, so
     * nothing flickers while it does.
     */
    const applyAcceptedWords = async (added: ReadonlySet<string>) => {
        if (added.size > 0) {
            log.info('Wordlist gained words, filtering in place', { words: [...added] });
            for (const [uri, diagnostics] of store) {
                const document = findOpenDocument(uri);
                if (!document) continue;
                const remaining = diagnostics.filter(d => {
                    const ruleId = ruleIdOf(d, '');
                    if (!isSpellingRule(ruleId)) return true;
                    return !added.has(document.getText(d.range).toLowerCase());
                });
                if (remaining.length === diagnostics.length) continue;
                store.write(uri, document.uri, remaining);
            }
            store.notify();
        }
        await core.initialize();
        // No clear: `checkDocument` replaces a document's diagnostics in one
        // go when it finishes, so there is no window in which the file looks
        // clean.
        for (const editor of vscode.window.visibleTextEditors) {
            if (isCheckable(editor.document)) checker.check(editor.document);
        }
    };

    const refreshDictionaryWatchers = async () => {
        for (const watcher of dictionaryWatchers) watcher.dispose();
        dictionaryWatchers = [];

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;

        const schemaWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, SCHEMA_DIR_PATTERN),
        );
        const reloadSchemas = () => reinitializeAndRecheck();
        schemaWatcher.onDidChange(reloadSchemas);
        schemaWatcher.onDidCreate(reloadSchemas);
        schemaWatcher.onDidDelete(reloadSchemas);
        dictionaryWatchers.push(schemaWatcher);
        context.subscriptions.push(schemaWatcher);

        const paths = new Set<string>([
            // The file `Add to dictionary` writes to. The core updates its own
            // copy when it writes there, but a hand edit is a change like any
            // other.
            '.languagecheck/dictionary.txt',
            ...getSetting('dictionaries.paths'),
        ]);
        if (configState.seen.state === 'present') {
            for (const configured of parseDictionaryPaths(configState.seen.text)) {
                paths.add(configured);
            }
        }

        for (const relative of paths) {
            // An absolute path is outside the workspace and outside what a
            // workspace-relative pattern can express; the core still reads it,
            // it simply is not watched.
            if (path.isAbsolute(relative)) continue;
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, relative),
            );
            const uri = vscode.Uri.joinPath(folder.uri, relative);
            const key = uri.toString();
            wordlistContents.set(key, await readWordlist(uri));
            const reload = async () => {
                const before = wordlistContents.get(key) ?? '';
                const after = await readWordlist(uri);
                wordlistContents.set(key, after);
                const added = wordsAdded(before, after);
                if (added === null) {
                    // A word was taken away, or the file was rewritten.
                    await reinitializeAndRecheck();
                    return;
                }
                await applyAcceptedWords(added);
            };
            watcher.onDidChange(reload);
            watcher.onDidCreate(reload);
            watcher.onDidDelete(reload);
            dictionaryWatchers.push(watcher);
            context.subscriptions.push(watcher);
        }
    };

    configWatcher.onDidChange(checkConfigChange);
    configWatcher.onDidCreate(checkConfigChange);
    configWatcher.onDidDelete(checkConfigChange);
    context.subscriptions.push(configWatcher);

    // Eagerly read the initial config values so we can detect changes
    // even if the config was modified before the extension activated.
    {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const found = folder ? await readFirstConfig(folder) : undefined;
        if (found) {
            const raw = found.text;
            configState.seen = { state: 'present', text: raw };
            statusBars.setLanguage(spellLanguageOf(raw));
            configState.apply(raw);
        }
    }

    // After the config has been read, not before: the wordlists to watch are
    // named in it, and registering the watchers first meant a path from
    // `dictionaries.paths` was never watched at all. Editing the wordlist
    // then did nothing until the config file itself happened to change.
    await refreshDictionaryWatchers();

    // Listen for diagnostic changes to keep SpeedFix in sync
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => {
        updateSpeedFixDiagnostics();
    }));

    context.subscriptions.push(store);
    context.subscriptions.push(inlayHintEmitter);

    // Expose public API for other extensions
    const api = createAPI(
        core.client!,
        async (uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]> => {
            if (!core.client) return [];
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const languageId = document.languageId;

            try {
                const response = await core.client.sendRequest({
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

/**
 * Offer to install a pack for any language the core could not check.
 *
 * Called after every check, so the guard conditions carry the weight: the
 * language comes from the core rather than from parsing a message, it must be
 * one a pack exists for, and it must not have been asked about this session or
 * refused in any previous one.
 */
async function offerMissingPacks(diagnostics: readonly ExtendedDiagnostic[]): Promise<void> {
    if (!extensionContext) return;
    // globalState, not workspaceState: a refusal is about the user's opinion
    // of a language, not about one folder, and it has to outlive a reload.
    const memory = extensionContext.globalState;

    for (const candidate of uncheckedLanguages(diagnostics)) {
        if (!shouldPrompt(memory, packsOfferedThisSession, candidate)) continue;
        // Recorded before awaiting, so a second check finishing while the
        // modal is open cannot raise a second one.
        packsOfferedThisSession.add(candidate.language.replace(/_/g, '-').toLowerCase());

        // LanguageTool covers this language too, and covers it better --
        // grammar and style, where Hunspell gives spelling alone. Offering
        // only the narrower one would hide the choice from someone who would
        // have picked the other.
        const ltIsAnOption =
            languageToolCovers(candidate.language) &&
            // Undeclared in package.json, so this is always the fallback
            // unless set by hand in settings.json.
            !getUndeclaredSetting('engines.languagetool', false);

        const install = vscode.l10n.t('Install');
        const setUpLT = vscode.l10n.t('Set up LanguageTool');
        const notNow = vscode.l10n.t('Not now');
        const never = vscode.l10n.t("Don't ask again");

        // "None of your enabled checkers", not "nothing installed": a user
        // whose only engine is their own external checker still has one, it
        // just does not declare this language. Telling them they have
        // nothing is both false and a reason to distrust the rest.
        const message = ltIsAnOption
            ? vscode.l10n.t(
                'None of your enabled checkers read {0}. Hunspell adds spelling for it; LanguageTool adds grammar and style as well.',
                candidate.language
            )
            : vscode.l10n.t(
                'None of your enabled checkers read {0}. Install the Hunspell dictionary for it?',
                candidate.language
            );

        const choices = ltIsAnOption
            ? [install, setUpLT, notNow, never]
            : [install, notNow, never];
        const choice = await vscode.window.showInformationMessage(message, ...choices);

        if (choice === install) {
            await installDictionaryPack(extensionContext, candidate.language);
        } else if (choice === setUpLT) {
            // The Docker path already exists and does the whole setup, so this
            // hands over rather than reimplementing it.
            await executeCommand(COMMANDS.restartLTDocker);
        } else if (choice === never) {
            await declinePack(memory, candidate.language);
        }
        // "Not now" and a dismissed modal are the same thing: nothing is
        // remembered past this session, and the quick fix stays available.
    }
}

/**
 * Run the core's pack installer and re-check once it lands.
 *
 * Shells out to the CLI beside the server binary rather than adding an RPC:
 * an install is a one-off that writes to disk and prints its own progress,
 * which is what a command line is for.
 */
async function installDictionaryPack(
    context: vscode.ExtensionContext,
    language: string
): Promise<void> {
    if (!isLanguageTag(language)) {
        log.warn('Refusing to install a pack for an implausible tag', { language });
        return;
    }
    // Asking again means the user changed their mind, so the refusal goes.
    await forgetDecline(context.globalState, language);

    const cli = resolveCliPath();
    if (!cli) {
        void vscode.window.showErrorMessage(
            vscode.l10n.t('Could not find the language-check binary to install the dictionary.')
        );
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Installing the {0} dictionary…', language),
            cancellable: false,
        },
        async () => {
            const result = await runPackInstall(cli, language);
            if (result.ok) {
                void vscode.window.showInformationMessage(
                    vscode.l10n.t('Installed the {0} dictionary.', language)
                );
                inspectorLog.push('info', 'packs', `Installed ${language}`, {
                    details: result.output.trim().split('\n').at(-1) ?? '',
                });
                await reinitializeAndRecheckRef?.();
            } else {
                // The core's message names the file and the reason; passing it
                // through beats replacing it with something vaguer.
                void vscode.window.showErrorMessage(
                    vscode.l10n.t('Could not install the {0} dictionary: {1}', language, result.output.trim())
                );
                inspectorLog.push('error', 'packs', `Install failed for ${language}`, {
                    details: result.output.trim(),
                });
            }
        }
    );
}

/** `language-check`, beside whichever `language-check-server` is in use. */
function resolveCliPath(): string | null {
    const server = core.currentServerPath;
    if (!server) return null;
    const cli = path.join(path.dirname(server), process.platform === 'win32' ? 'language-check.exe' : 'language-check');
    return fs.existsSync(cli) ? cli : null;
}

/** Run `packs install`, capturing whatever it said. */
function runPackInstall(cli: string, language: string): Promise<{ ok: boolean; output: string }> {
    return new Promise(resolve => {
        // execFile, not a shell: the tag is validated above and still never
        // reaches a command line where it could be anything but an argument.
        execFile(cli, ['packs', 'install', language], { timeout: 300_000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, output: `${stdout}${stderr}` });
        });
    });
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

/** Detect engine binaries and config files, updating `engineInfoState`. */
async function detectEngineInfo(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];

    // Read .languagecheck config to determine enabled state
    const found = folder ? await readFirstConfig(folder) : undefined;
    const configContent = found?.text ?? '';
    const configFilePath = found?.uri.fsPath ?? '';

    const isEnabled = (key: string, defaultVal: boolean) => engineEnabled(configContent, key, defaultVal);

    /** Check if a binary exists in PATH. */
    function binaryInPath(name: string): boolean {
        try {
            execSync(`command -v ${name}`, { stdio: 'pipe' });
            return true;
        } catch { return false; }
    }

    /** Find an engine-specific config file. */
    function findConfig(candidates: string[]): string {
        if (!folder) return '';
        for (const name of candidates) {
            const p = path.join(folder.uri.fsPath, name);
            if (fs.existsSync(p)) return p;
        }
        return '';
    }

    const infos: InspectorEngineInfo[] = [
        {
            name: 'harper',
            enabled: isEnabled('harper', true),
            type: 'builtin',
            binaryDetected: true,
            configPath: configFilePath ? `${configFilePath} (engines.harper)` : '',
        },
        {
            name: 'languagetool',
            enabled: isEnabled('languagetool', false),
            type: 'external',
            binaryDetected: true, // server-based, not a binary — always "available"
            configPath: configFilePath ? `${configFilePath} (engines.languagetool)` : '',
        },
        {
            name: 'vale',
            enabled: isEnabled('vale', false),
            type: 'external',
            binaryDetected: binaryInPath('vale'),
            configPath: findConfig(['.vale.ini', '.vale.yaml', '.vale.yml']),
        },
        {
            name: 'proselint',
            enabled: isEnabled('proselint', false),
            type: 'external',
            binaryDetected: binaryInPath('proselint'),
            configPath: findConfig(['proselint.json', '.proselintrc']),
        },
    ];

    engineInfoState = infos;
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

    // Send real extraction data from cache.
    //
    // Everything here comes from one CheckProse response, so the syntax and the
    // per-range language always describe the boxes shown beside them. When the
    // cache has been dropped — a config change invalidates it — there is
    // nothing to show until the re-check lands, which is the point: a language
    // from the previous config is worse than an empty panel.
    const cached = results.extraction.get(uri);
    inspectorPanel.webview.postMessage({
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
    inspectorPanel.webview.postMessage({
        type: 'setNames',
        payload: { names: results.names.get(uri) ?? [] },
    });

    // Send real benchmark timings if available
    if (results.timings.length > 0) {
        inspectorPanel.webview.postMessage({
            type: 'setLatency',
            payload: { stages: results.timings },
        });
    }

    // Send check info if available
    if (results.info) {
        inspectorPanel.webview.postMessage({
            type: 'setCheckInfo',
            payload: results.info,
        });
    }

    // Send diagnostic summary
    const diags = store.get(uri);
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
        inspectorPanel.webview.postMessage({
            type: 'setDiagnosticSummary',
            payload: summary,
        });
    }

    // Send engine health state
    if (results.engineHealth.length > 0) {
        inspectorPanel.webview.postMessage({
            type: 'setEngineHealth',
            payload: results.engineHealth,
        });
    }

    // Send engine info (binary detection, config paths)
    await detectEngineInfo();
    inspectorPanel.webview.postMessage({
        type: 'setEngineInfo',
        payload: engineInfoState,
    });
}

/** Find a text editor that has diagnostics, preferring activeTextEditor.
 *  Falls back to visibleTextEditors when a webview panel has stolen focus.
 *  When a SpeedFix target URI is set, prefer that editor. */
function findEditorWithDiagnostics(): vscode.TextEditor | undefined {
    // Prefer the SpeedFix target (set by workspace-mode auto-advance)
    if (speedFixTargetUri) {
        const target = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === speedFixTargetUri
        );
        if (target && store.has(speedFixTargetUri)) return target;
    }
    const active = vscode.window.activeTextEditor;
    if (active && store.has(active.document.uri.toString())) return active;
    // Fallback: find a visible editor that has diagnostics
    return vscode.window.visibleTextEditors.find(e =>
        store.has(e.document.uri.toString())
    );
}

async function applyFix(diagnosticId: string, suggestion: string) {
    const editor = findEditorWithDiagnostics();
    if (!editor) return;

    const uri = editor.document.uri;
    const uriStr = uri.toString();
    const diagnostics = store.get(uriStr);
    if (!diagnostics) return;

    const index = parseDiagId(diagnosticId);
    const diagnostic = diagnostics[index];
    if (!diagnostic) return;

    const t0 = performance.now();
    const origText = editor.document.getText(diagnostic.range);
    log.debug('applyFix', { diagnosticId, suggestion, original: origText });
    inspectorLog.push('info', 'applyFix', `"${origText}" → "${suggestion}"`);
    sendSpeedFixLoading(true);

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
        sendSpeedFixLoading(false);
        // Refocus the SpeedFix panel so the user can continue through issues
        speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
    }
}

async function ignoreDiagnostic(diagnosticId: string) {
    const editor = findEditorWithDiagnostics();
    if (!editor || !core.client) return;

    const uri = editor.document.uri.toString();
    const diagnostics = store.get(uri);
    if (!diagnostics) return;

    const index = parseDiagId(diagnosticId);
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        sendSpeedFixLoading(true);
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
        sendSpeedFixLoading(false);
        inspectorLog.push('info', 'ignoreDiagnostic', 'Ignore confirmed, re-checking', { durationMs: performance.now() - t0 });

        // Background re-check for full consistency
        checker.check(editor.document);
    }
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


function updateSpeedFixDiagnostics() {
    if (!speedFixPanel) return;
    const editor = findEditorWithDiagnostics() ?? vscode.window.activeTextEditor;

    if (editor) {
        const diagnostics = store.get(editor.document.uri.toString());
        if (diagnostics && diagnostics.length > 0) {
            speedFixTargetUri = editor.document.uri.toString();
            const fileName = path.basename(editor.document.uri.fsPath);
            const payload: SpeedFixDiagnostic[] = diagnostics.map((d, i) =>
                toSpeedFixDiagnostic(d, i, editor.document, fileName));
            speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload });
            sendWorkspaceProgress();
            return;
        }
    }

    // Current file has no diagnostics — try workspace advance
    if (speedFixScope === 'workspace') {
        const currentUri = editor?.document.uri.toString();
        advanceToNextFileWithDiagnostics(currentUri);
        return;
    }

    speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload: [] });
    sendWorkspaceProgress();
}

/** In workspace mode, find and open the next file that has diagnostics. */
async function advanceToNextFileWithDiagnostics(currentUri?: string): Promise<void> {
    for (const [uriStr, diags] of store) {
        if (uriStr === currentUri || diags.length === 0) continue;

        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
        speedFixTargetUri = uriStr;

        const fileName = path.basename(doc.uri.fsPath);
        const payload: SpeedFixDiagnostic[] = diags.map((d, i) =>
            toSpeedFixDiagnostic(d, i, doc, fileName));
        speedFixPanel?.webview.postMessage({ type: 'setDiagnostics', payload });
        sendWorkspaceProgress();
        speedFixPanel?.reveal(vscode.ViewColumn.Beside, false);
        return;
    }

    // No more files with diagnostics — all done across workspace
    speedFixPanel?.webview.postMessage({ type: 'setDiagnostics', payload: [] });
    sendWorkspaceProgress();
}

function sendWorkspaceProgress() {
    if (!speedFixPanel || speedFixScope !== 'workspace') return;
    let filesWithIssues = 0;
    for (const [, diags] of store) {
        if (diags.length > 0) filesWithIssues++;
    }
    speedFixPanel.webview.postMessage({
        type: 'setWorkspaceProgress',
        payload: { filesWithIssues },
    });
}

export function deactivate() {
    // Clean up debounce timers
    debouncer.cancelAll();

    core?.stop();
}
