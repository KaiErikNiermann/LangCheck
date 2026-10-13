// The web extension's composition root: the VS Code client's own checking
// pipeline (Checker, DiagnosticStore, CheckResults, InspectorLog, actions,
// code actions, command handlers), wired to the native-messaging transport
// instead of the stdio core. What is web-only here is the wiring: triggers
// that fit a browser editor, which commands exist, and inlay hints.
import * as vscode from 'vscode';
import { Checker } from '../../../extension/src/checking/checker';
import { CheckResults } from '../../../extension/src/checking/results';
import { Debouncer } from '../../../extension/src/checking/scheduler';
import { checkCommands } from '../../../extension/src/commands/check';
import { diagnosticsCommands } from '../../../extension/src/commands/diagnostics';
import { COMMANDS } from '../../../extension/src/commands/ids';
import { ENGINES } from '../../../extension/src/core/engines';
import { DiagnosticActions } from '../../../extension/src/diagnostics/actions';
import { FixTarget } from '../../../extension/src/diagnostics/fixTarget';
import { DiagnosticStore, Suppression } from '../../../extension/src/diagnostics/store';
import { registerCodeActions } from '../../../extension/src/providers/codeActions';
import { uriKey } from '../../../extension/src/shared/documents';
import { formatSuggestionLabel } from '../../../extension/src/shared/inlayLabels';
import { InspectorLog } from '../../../extension/src/ui/inspectorLog';
import { InspectorPanel, type InspectorEnvironment } from '../../../extension/src/ui/webviews/inspector';
import { SpeedFixPanel, speedFixActions } from '../../../extension/src/ui/webviews/speedFix';
import type { CoreClient } from '../messaging/pageClient';
import { DEFAULT_CHECK_SETTINGS, type ForeignMode } from '../messaging/protocol';
import { WEBVIEW_TYPE } from '../messaging/webview';
import { host } from '../shim/vscode';
import type { SiteDictionarySource } from '../sites/site';
import { syncSiteDictionary, type SiteDictionarySync } from './siteDictionary';
import { WebCore } from './transport';

/** Typing pause before a check, as in the VS Code client's default. */
export const CHECK_DELAY_MS = 500;

/** The commands the web registers, of all the client's handlers. */
export const WEB_COMMANDS: ReadonlySet<string> = new Set([
    COMMANDS.checkDocument,
    COMMANDS.addToDictionary,
    COMMANDS.applyFix,
    COMMANDS.ignoreDiagnostic,
    COMMANDS.ignoreSelection,
    COMMANDS.fixAllSpellingInFile,
    COMMANDS.fixAllSpellingInWorkspace,
    COMMANDS.openSpeedFix,
    COMMANDS.openInspector,
    COMMANDS.editConfig,
]);

const SELECTOR = ['latex', 'typst', 'bibtex', 'markdown', 'plaintext'].map((language) => ({ language }));

/** What the client reports about itself, for the page's debugging handle and the tests. */
export interface ClientStats {
    /** Checks that ran to completion (the Checker recorded them). */
    readonly checks: number;
    /** Findings held for the page's documents: what is drawn and what is scrolled out of view. */
    readonly findings: number;
    /** Documents anything is held for (findings, or a check's extraction). */
    readonly documents: number;
}

/**
 * The client's Logger, on the browser console. Debug lines are dropped, as
 * VS Code hides its debug level by default; the Inspector log carries them.
 */
const console_ = {
    debug: () => {},
    warn: (message: string, data: unknown = '') => {
        console.warn('[language-check]', message, data);
    },
    error: (message: string, data: unknown = '') => {
        console.error('[language-check]', message, data);
    },
};

/** Nothing in the page shows a status bar; the Inspector shows health instead. */
const NO_STATUS_BARS = { setChecking: () => {}, updateHealth: () => {}, updateInsights: () => {} };
/**
 * What the Inspector reports about the machine, as far as a page can tell. It
 * cannot run Docker or look on PATH, and the config that turns engines on is
 * the core's, out of the page's reach (its paths are local). So an engine is
 * on when the core has reported its health -- it ran -- and an external
 * engine whose program is missing shows as down, with the core's error,
 * rather than "not found".
 */
function webEnvironment(results: CheckResults): InspectorEnvironment {
    return {
        hasDockerCompose: () => false,
        detectEngineInfo: () =>
            Promise.resolve(
                ENGINES.map((engine) => ({
                    name: engine.name,
                    enabled: results.engineHealth.some((health) => health.name === engine.name),
                    type: engine.type,
                    binaryDetected: true,
                    configPath: '',
                })),
            ),
    };
}

/** `siteDictionary`: the site's own dictionary, for a site that keeps one. */
export function startClient(context: vscode.ExtensionContext, connection: CoreClient, siteDictionary?: SiteDictionarySource): () => ClientStats {
    let completed = 0;
    let reportedUnavailable = false;
    const store = new DiagnosticStore();
    const results = new CheckResults();
    const inspectorLog = new InspectorLog();
    const suppression = new Suppression();
    const fixTarget = new FixTarget(store);
    const debouncer = new Debouncer();
    /** Keeps the core's copy of the site's dictionary current; set up once the client has started. */
    let siteSync: SiteDictionarySync | undefined;
    // The site's own spellchecker: merged into ours until the options page
    // says otherwise (research/foreign-checkers.md).
    let foreignMode: ForeignMode = DEFAULT_CHECK_SETTINGS.foreignCheckers;
    const adapterOf = (doc: vscode.TextDocument) => host.documents.get(doc.uri.toString())?.adapter;
    const hintsChanged = new vscode.EventEmitter<void>();

    const core = new WebCore(connection, {
        unavailable: (reason) => {
            // Once per outage, not once per keystroke.
            if (reportedUnavailable) return;
            reportedUnavailable = true;
            void vscode.window.showErrorMessage(
                vscode.l10n.t('LangCheck cannot reach its checker: {0}. Install the native host with "language-check-native-host install --browser <firefox|chrome>".', reason),
            );
        },
        tooLong: (limitBytes) => {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('This document is too long for LangCheck to check in the browser (more than {0} MB). Findings are hidden until it is shorter.', String(limitBytes / (1024 * 1024))),
            );
        },
        recovered: () => {
            reportedUnavailable = false;
            checkAll();
        },
        writeToSite: async (source, word) => {
            if (siteDictionary?.source !== source) return `There is no ${source} dictionary on this page to add "${word}" to.`;
            const failure = await siteDictionary.add(word);
            // The site has it now: read it back, so the core's copy agrees.
            siteSync?.refresh();
            return failure;
        },
    });

    const speedFix: SpeedFixPanel = new SpeedFixPanel({
        context,
        store,
        fixTarget,
        actions: speedFixActions(
            () => actions,
            () => checker,
        ),
    });
    const inspector = new InspectorPanel({
        context,
        store,
        results,
        fixTarget,
        inspectorLog,
        check: (document) => checker.check(document),
        // By file name (the host scrubs paths), without the files it selects:
        // in the browser those are the native host's own (background.ts forPage).
        listConfigFiles: async () => {
            const answer = await core.client.sendRequest({ listConfigFiles: {} });
            return answer.listConfigFiles ?? null;
        },
        environment: webEnvironment(results),
    });

    const checker: Checker = new Checker({
        core,
        log: console_,
        store,
        suppression,
        results,
        statusBars: NO_STATUS_BARS,
        inspectorLog,
        languageToolRestartable: () => false,
        // Where the user is in the page's editor, for a progressive check to start there.
        focusOf: (document) => adapterOf(document)?.focusOffset?.(),
        foreignOf: (document) => (foreignMode === 'merge' ? (adapterOf(document)?.foreignFindings?.() ?? []) : []),
        observer: {
            checkRecorded: (document, timings) => {
                completed++;
                hintsChanged.fire();
                inspector.checkRecorded(document, timings);
            },
            healthUpdated: () => {
                inspector.healthUpdated();
            },
            diagnosticsPublished: () => {},
        },
    });
    const actions: DiagnosticActions = new DiagnosticActions({ core, checker, log: console_, inspectorLog, store, fixTarget, speedFix });

    const check = (doc: vscode.TextDocument): void => {
        void checker.check(doc);
    };
    const checkAll = (): void => {
        for (const doc of vscode.workspace.textDocuments) check(doc);
    };
    /** Hide the site's checker as the mode says; while merging, check again when it answers. */
    const joinForeign = (doc: vscode.TextDocument): void => {
        const adapter = adapterOf(doc);
        adapter?.setForeignHidden?.(foreignMode !== 'both');
        adapter?.onDidChangeForeign?.(() => {
            if (foreignMode !== 'merge') return;
            debouncer.schedule(uriKey(doc.uri), CHECK_DELAY_MS, () => {
                check(doc);
            });
        });
    };

    const handlers: Record<string, (...args: never[]) => unknown> = {
        ...checkCommands({ results, checker, speedFix, inspector }),
        ...diagnosticsCommands({ log: console_, store, suppression, inspectorLog, fixTarget, core, checker, actions, speedFix }),
        // The web's own: the config is the native host's, edited in the
        // extension's config page, which the background opens for this workspace.
        [COMMANDS.editConfig]: () => {
            connection.post({ type: WEBVIEW_TYPE, op: 'openConfig' });
        },
    };
    // The options page's checking settings, as the client's own
    // `languageCheck.check.*` (the content script sends them).
    connection.onSettings((settings) => {
        host.settings.set('languageCheck.check.progressive', settings.progressive);
        host.settings.set('languageCheck.check.windowBytes', settings.windowBytes);
        host.settings.set('languageCheck.check.maxBytes', settings.maxBytes);
        if (settings.foreignCheckers === foreignMode) return;
        foreignMode = settings.foreignCheckers;
        for (const doc of vscode.workspace.textDocuments) adapterOf(doc)?.setForeignHidden?.(foreignMode !== 'both');
        checkAll();
    });
    // Saved there: the core re-read it, and checks run again under it, as
    // VS Code's reload does after a config change.
    connection.onReload(() => {
        store.clear();
        results.clearDocuments();
        void inspector.update();
        // include, exclude and file_types may be what changed.
        void inspector.refreshConfigScope();
        checkAll();
    });
    for (const [id, handler] of Object.entries(handlers)) {
        if (WEB_COMMANDS.has(id)) context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    registerCodeActions(context.subscriptions, { store, offers: (command) => WEB_COMMANDS.has(command) });

    // Findings are drawn and offered only while they describe the text, by
    // the version the store recorded for the check (shim: describesText).
    host.findingsCurrent = (doc) => store.isCurrent(doc);
    context.subscriptions.push({
        dispose: () => {
            host.findingsCurrent = undefined;
        },
    });
    // The page has one editor, so unlike VS Code there is no active-editor
    // change for the Inspector to follow.
    store.onChange(() => {
        speedFix.update();
    });
    context.subscriptions.push(
        store,
        hintsChanged,
        core,
        { dispose: () => { debouncer.cancelAll(); } },
        vscode.workspace.onDidOpenTextDocument((doc) => {
            joinForeign(doc);
            check(doc);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            const doc = event.document;
            debouncer.schedule(uriKey(doc.uri), CHECK_DELAY_MS, () => {
                check(doc);
            });
        }),
        // A page's documents do not come back once closed (a file switched
        // away from, a Notion page left): forget them, as VS Code forgets
        // its caches on close, or every document visited stays held.
        vscode.workspace.onDidCloseTextDocument((doc) => {
            debouncer.cancel(uriKey(doc.uri));
            store.forget(uriKey(doc.uri), doc.uri);
            results.forget(uriKey(doc.uri));
            store.notify();
        }),
        // The top suggestion as ghost text after each finding, as in VS Code;
        // only while the findings still describe the text.
        vscode.languages.registerInlayHintsProvider(SELECTOR, {
            onDidChangeInlayHints: hintsChanged.event,
            provideInlayHints(doc) {
                if (!store.isCurrent(doc)) return [];
                return (store.get(uriKey(doc.uri)) ?? []).flatMap((d) => {
                    const label = formatSuggestionLabel(doc.getText(d.range), d.suggestions?.[0]);
                    return label === null ? [] : [new vscode.InlayHint(d.range.end, label.label.trim())];
                });
            },
        }),
    );

    for (const doc of vscode.workspace.textDocuments) joinForeign(doc);
    checkAll();
    // The site's own dictionary, kept current in the core; a change checks again.
    if (siteDictionary !== undefined) {
        siteSync = syncSiteDictionary(siteDictionary, {
                send: async (source, words) => {
                    const response = await core.client.sendRequest({ siteDictionary: { source, words: [...words] } });
                    return Boolean(response.ok);
                },
                changed: checkAll,
                warn: (message, error) => {
                    console.warn('[language-check]', message, error);
                },
            });
        context.subscriptions.push(siteSync);
    }
    return () => ({
        checks: completed,
        findings: [...store].reduce((sum, [, list]) => sum + list.length, 0),
        documents: new Set([...[...store].map(([uri]) => uri), ...results.extraction.keys()]).size,
    });
}
