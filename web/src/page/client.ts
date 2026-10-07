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
import { host } from '../shim/vscode';
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

export function startClient(context: vscode.ExtensionContext, connection: CoreClient): () => ClientStats {
    let completed = 0;
    let reportedUnavailable = false;
    const store = new DiagnosticStore();
    const results = new CheckResults();
    const inspectorLog = new InspectorLog();
    const suppression = new Suppression();
    const fixTarget = new FixTarget(store);
    const debouncer = new Debouncer();
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
        // The host refuses config listings to the web (they name local paths).
        listConfigFiles: () => Promise.resolve(null),
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

    const handlers: Record<string, (...args: never[]) => unknown> = {
        ...checkCommands({ results, checker, speedFix, inspector }),
        ...diagnosticsCommands({ log: console_, store, suppression, inspectorLog, fixTarget, core, checker, actions, speedFix }),
    };
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
        vscode.workspace.onDidOpenTextDocument(check),
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

    checkAll();
    return () => ({
        checks: completed,
        findings: [...store].reduce((sum, [, list]) => sum + list.length, 0),
        documents: new Set([...[...store].map(([uri]) => uri), ...results.extraction.keys()]).size,
    });
}
