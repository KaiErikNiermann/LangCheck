import * as vscode from 'vscode';
import * as path from 'path';
import { TraceLogger } from './shared/trace';
import { createAPI, severityToString } from './api';
import type { LanguageCheckDiagnostic } from './api';
import { parseDictionaryPaths, wordsAdded } from './config/parsing';
import { YAML_EXTENSION_ID, declineYamlSuggestion, shouldSuggestYaml } from './config/yamlSuggestion';
import { Logger } from './shared/logger';
import { ConfigStatusView } from './config/gutter';
import { classifyConfigChange } from './config/rules';
import { spellLanguageOf } from './config/edits';
import { CONFIG_FILE_NAMES, readFirstConfig } from './config/file';
import { isSpellingRule, ruleIdOf } from './diagnostics/diagnostic';
import { findOpenDocument } from './shared/documents';
import { DiagnosticStore, Suppression } from './diagnostics/store';
import { CheckResults } from './checking/results';
import { InspectorLog } from './ui/inspectorLog';
import { COMMANDS, registerCommand } from './commands/ids';
import { getSetting, settingId } from './config/settings';
import { SUPPORTED_LANGUAGES, isCheckableIn } from './checking/languages';
import { StatusBars } from './ui/statusBars';
import { CoreService } from './core/coreService';
import { Checker } from './checking/checker';
import { Debouncer } from './checking/scheduler';
import type { FixTarget } from './diagnostics/fixTarget';
import { SpeedFixPanel } from './ui/webviews/speedFix';
import { DiagnosticActions } from './diagnostics/actions';
import { InspectorPanel } from './ui/webviews/inspector';
import { Packs } from './core/packs';
import { Reloader } from './checking/reload';
import { InlayHintSwitch, registerInlayHints } from './providers/inlayHints';
import { registerInlineCompletions } from './providers/inlineCompletions';
import { registerCodeActions } from './providers/codeActions';
import { registerCommands } from './commands';
import { bootstrapCore } from './core/binary';
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
let inlayHintSwitch: InlayHintSwitch;
let fixTarget: FixTarget;
let speedFix: SpeedFixPanel;
let actions: DiagnosticActions;
let inspector: InspectorPanel;
let packs: Packs;
let reloader: Reloader;
let configStatusView: ConfigStatusView | null = null;


// Engine health tracking



// Check-on-change debounce timer per document
const debouncer = new Debouncer();

let yamlOfferedThisSession = false;


export async function activate(context: vscode.ExtensionContext) {
    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    log = new Logger(isDev);
    context.subscriptions.push({ dispose: () => log.dispose() });

    ({ store, suppression, results, statusBars, configState, inspectorLog, inlayHintEmitter, inlayHintSwitch, fixTarget } = createServices());
    speedFix = new SpeedFixPanel({
        context, store, fixTarget,
        actions: {
            applyFix: (diagnosticId, suggestion) => actions.applyFix(diagnosticId, suggestion),
            ignore: diagnosticId => actions.ignore(diagnosticId),
            check: document => checker.check(document),
        },
    });
    // What every diagnostics change refreshes, in this order.
    store.onChange(() => inlayHintEmitter.fire());
    store.onChange(() => speedFix.update());
    inspector = new InspectorPanel({
        context, store, results, fixTarget, inspectorLog,
        check: document => checker.check(document),
    });
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
            checkRecorded: timings => inspector.checkRecorded(timings),
            healthUpdated: () => inspector.healthUpdated(),
            diagnosticsPublished: diagnostics => void packs.offer(diagnostics),
        },
    });
    actions = new DiagnosticActions({ core, checker, log, inspectorLog, store, fixTarget, speedFix });
    packs = new Packs({ context, core, log, inspectorLog, reload: () => reloader.reinitializeAndRecheck() });

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

    const isCheckable = (document: vscode.TextDocument) => isCheckableIn(document, core.schemaExtensions);

    reloader = new Reloader({ log, core, store, results, statusBars, inspector, checker, isCheckable });


    registerInlayHints(context.subscriptions, { store, configState, log, emitter: inlayHintEmitter, hintSwitch: inlayHintSwitch });
    registerInlineCompletions(context.subscriptions, { store });
    registerCodeActions(context.subscriptions, { store });
    registerCommands(context.subscriptions, {
        context, log, isDev, store, suppression, results, statusBars, configState, inspectorLog,
        inlayHintEmitter, inlayHintSwitch, fixTarget, core, checker, actions, speedFix, inspector, packs, reloader,
    });

    // Update inspector when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async () => {
        await inspector.update();
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
            await inspector.update();
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
            await reloader.reinitializeAndRecheck();
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
                    await reloader.applySilencedRules(change.newlyOff);
                    configStatusView?.refresh();
                } else if (changed) {
                    // Before the recheck: the config may have named a
                    // different wordlist, and the new one has to be watched
                    // from now on.
                    await refreshDictionaryWatchers();
                    await reloader.reinitializeAndRecheck();
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
            await reloader.reinitializeAndRecheck();
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
        const reloadSchemas = () => reloader.reinitializeAndRecheck();
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
                    await reloader.reinitializeAndRecheck();
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
        speedFix.update();
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

















export function deactivate() {
    // Clean up debounce timers
    debouncer.cancelAll();

    core?.stop();
}
