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
import { DiagnosticActions } from '../../../extension/src/diagnostics/actions';
import { FixTarget } from '../../../extension/src/diagnostics/fixTarget';
import { DiagnosticStore, Suppression } from '../../../extension/src/diagnostics/store';
import { registerCodeActions } from '../../../extension/src/providers/codeActions';
import { uriKey } from '../../../extension/src/shared/documents';
import { formatSuggestionLabel } from '../../../extension/src/shared/inlayLabels';
import { InspectorLog } from '../../../extension/src/ui/inspectorLog';
import type { CoreClient } from '../messaging/pageClient';
import { WebCore } from './transport';

/** Typing pause before a check, as in the VS Code client's default. */
export const CHECK_DELAY_MS = 500;

/** The commands the web registers, of all the client's handlers. */
const WEB_COMMANDS: ReadonlySet<string> = new Set([
    COMMANDS.checkDocument,
    COMMANDS.addToDictionary,
    COMMANDS.applyFix,
    COMMANDS.ignoreDiagnostic,
    COMMANDS.ignoreSelection,
    COMMANDS.fixAllSpellingInFile,
    COMMANDS.fixAllSpellingInWorkspace,
]);

const SELECTOR = ['latex', 'typst', 'bibtex', 'markdown', 'plaintext'].map((language) => ({ language }));

/** What the client reports about itself, for the page's debugging handle and the tests. */
export interface ClientStats {
    /** Checks that ran to completion (the Checker recorded them). */
    readonly checks: number;
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
/** Until the SpeedFix panel exists in the web (see webview host), its loading signals go nowhere. */
const NO_SPEEDFIX = { sendLoading: () => {}, reveal: () => {}, open: () => {} };
const NO_INSPECTOR = { open: () => {} };

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
    /** The document version each document's findings were computed at. */
    const checkedAt = new Map<string, number>();

    const core = new WebCore(connection, {
        unavailable: (reason) => {
            // Once per outage, not once per keystroke.
            if (reportedUnavailable) return;
            reportedUnavailable = true;
            void vscode.window.showErrorMessage(
                vscode.l10n.t('LangCheck cannot reach its checker: {0}. Install the native host with "language-check-native-host install --browser <firefox|chrome>".', reason),
            );
        },
        recovered: () => {
            reportedUnavailable = false;
            checkAll();
        },
    });

    const checker = new Checker({
        core,
        log: console_,
        store,
        suppression,
        results,
        statusBars: NO_STATUS_BARS,
        inspectorLog,
        languageToolRestartable: () => false,
        observer: {
            checkRecorded: (document) => {
                completed++;
                checkedAt.set(uriKey(document.uri), document.version);
                hintsChanged.fire();
            },
            healthUpdated: () => {},
            diagnosticsPublished: () => {},
        },
    });
    const actions = new DiagnosticActions({ core, checker, log: console_, inspectorLog, store, fixTarget, speedFix: NO_SPEEDFIX });

    const check = (doc: vscode.TextDocument): void => {
        void checker.check(doc);
    };
    const checkAll = (): void => {
        for (const doc of vscode.workspace.textDocuments) check(doc);
    };

    const handlers: Record<string, (...args: never[]) => unknown> = {
        ...checkCommands({ results, checker, speedFix: NO_SPEEDFIX, inspector: NO_INSPECTOR }),
        ...diagnosticsCommands({ log: console_, store, suppression, inspectorLog, fixTarget, core, checker, actions, speedFix: NO_SPEEDFIX }),
    };
    for (const [id, handler] of Object.entries(handlers)) {
        if (WEB_COMMANDS.has(id)) context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    registerCodeActions(context.subscriptions, { store, offers: (command) => WEB_COMMANDS.has(command) });

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
        vscode.workspace.onDidCloseTextDocument((doc) => {
            debouncer.cancel(uriKey(doc.uri));
            checkedAt.delete(uriKey(doc.uri));
            store.publishCheck(doc.uri, []);
        }),
        // The top suggestion as ghost text after each finding, as in VS Code;
        // only while the findings still describe the text.
        vscode.languages.registerInlayHintsProvider(SELECTOR, {
            onDidChangeInlayHints: hintsChanged.event,
            provideInlayHints(doc) {
                if (checkedAt.get(uriKey(doc.uri)) !== doc.version) return [];
                return (store.get(uriKey(doc.uri)) ?? []).flatMap((d) => {
                    const label = formatSuggestionLabel(doc.getText(d.range), d.suggestions?.[0]);
                    return label === null ? [] : [new vscode.InlayHint(d.range.end, label.label.trim())];
                });
            },
        }),
    );

    checkAll();
    return () => ({ checks: completed });
}
