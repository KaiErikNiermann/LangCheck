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
import { suggestionHints } from '../../../extension/src/providers/suggestionHints';
import { uriKey } from '../../../extension/src/shared/documents';
import { InspectorLog } from '../../../extension/src/ui/inspectorLog';
import { InspectorPanel, type InspectorEnvironment } from '../../../extension/src/ui/webviews/inspector';
import { SpeedFixPanel, speedFixActions } from '../../../extension/src/ui/webviews/speedFix';
import type { CoreClient } from '../messaging/pageClient';
import { DEFAULT_CHECK_SETTINGS, type ForeignMode, type InlayHintsMode } from '../messaging/protocol';
import { WEBVIEW_TYPE } from '../messaging/webview';
import { host } from '../shim/vscode';
import type { SiteDictionarySource, SiteFiles } from '../sites/site';
import { syncSiteDictionary, type SiteDictionarySync } from './siteDictionary';
import { followHintKeys, hintsVisible } from './hintVisibility';
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
    COMMANDS.excludeCurrentFile,
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

/** The page's documents as workspace files (SiteFiles), as the client asks for them. */
export interface PageFiles {
    /** The site's name, for what the Inspector and the commands say. */
    readonly siteName: string;
    /** The site's documents as files; undefined on a site that has none (Gmail). */
    readonly site: SiteFiles | undefined;
    /** Where the document at `fsPath` (its URI's path) is in the project now; without one, the open document's. */
    documentPath(fsPath?: string): string | undefined;
}

/** What the Inspector's Config tab says of the files on each kind of site. */
function scopeNote(files: PageFiles, listed: readonly string[] | undefined): { readonly note?: string; readonly filesless?: boolean } {
    if (files.site === undefined) {
        return { filesless: true, note: vscode.l10n.t('{0} has no files: whatever is written in it is checked, and include, exclude and file_types do not apply.', files.siteName) };
    }
    const note = files.site.note ?? (listed === undefined ? vscode.l10n.t("{0}'s file list could not be read, so only the open document is listed.", files.siteName) : undefined);
    return note === undefined ? {} : { note };
}

/**
 * `siteDictionary`: the site's own dictionary, for a site that keeps one;
 * `files`: how the site's documents are named as files.
 */
export function startClient(context: vscode.ExtensionContext, connection: CoreClient, files: PageFiles, siteDictionary?: SiteDictionarySource): () => ClientStats {
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
    // When the hints show (the options page), and whether Ctrl+Alt is held, which the pressed modes follow.
    const hints: { mode: InlayHintsMode; pressed: boolean } = { mode: DEFAULT_CHECK_SETTINGS.inlayHints, pressed: false };
    const stopFollowingKeys = followHintKeys(window, (pressed) => {
        hints.pressed = pressed;
        if (hints.mode === 'onUnlessPressed' || hints.mode === 'offUnlessPressed') hintsChanged.fire();
    });

    const core = new WebCore(connection, {
        unavailable: (reason) => {
            // Once per outage, not once per keystroke.
            if (reportedUnavailable) return;
            reportedUnavailable = true;
            void vscode.window.showErrorMessage(
                vscode.l10n.t('LangCheck cannot reach its checker: {0}.', reason),
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
            // Read it back and send it, so the core's copy agrees with the
            // site's whether the write took or not.
            siteSync?.refresh();
            return failure;
        },
        documentPath: (fsPath) => files.documentPath(fsPath),
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
        // By file name (the host scrubs paths), sorting the site's documents:
        // the host never lists its own files to a page. The open document is
        // always among them, read or not.
        listConfigFiles: async () => {
            const listed = await files.site?.list();
            const open = files.documentPath();
            const paths = [...new Set([...(listed ?? []), ...(open === undefined ? [] : [open])])];
            const answer = await core.client.sendRequest({ listConfigFiles: files.site === undefined ? {} : { documents: { paths } } });
            return answer.listConfigFiles ? { listing: answer.listConfigFiles, ...scopeNote(files, listed) } : null;
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
    /**
     * Checks every open document again, after something that changes the
     * answer without changing the text: the config, the site's dictionary,
     * the foreign-checker mode, a restarted core.
     *
     * Running checks are forgotten first. A check joins one already running
     * over the same text, and that one was sent before the change: the site's
     * words sent with the page's first check arrived just after it, the
     * recheck joined it, and the word the site had learned stayed marked.
     */
    const checkAll = (): void => {
        checker.invalidate();
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
        // VS Code's, for a site's document: its path goes into the config's
        // exclude, which the background writes (excludeDocument.ts); the
        // reload that follows checks again under it.
        [COMMANDS.excludeCurrentFile]: async () => {
            if (files.site === undefined) {
                void vscode.window.showInformationMessage(vscode.l10n.t('{0} has no files to exclude: whatever is written in it is checked.', files.siteName));
                return;
            }
            const path = files.documentPath();
            if (path === undefined) {
                void vscode.window.showWarningMessage(vscode.l10n.t('Open a file to exclude it from checking.'));
                return;
            }
            const answer = await connection.request({ excludeDocument: { path } });
            if (!answer.ok) {
                void vscode.window.showErrorMessage(vscode.l10n.t('Nothing was excluded: {0}', answer.error));
                return;
            }
            const excluded = answer.response.excluded as { pattern?: unknown; already?: unknown } | undefined;
            const pattern = typeof excluded?.pattern === 'string' ? excluded.pattern : path;
            void vscode.window.showInformationMessage(
                excluded?.already === true ? vscode.l10n.t('"{0}" is already excluded.', pattern) : vscode.l10n.t('Excluded "{0}". Reloading...', pattern),
            );
        },
    };
    // The options page's checking settings, as the client's own
    // `languageCheck.check.*` (the content script sends them).
    connection.onSettings((settings) => {
        host.settings.set('languageCheck.check.progressive', settings.progressive);
        host.settings.set('languageCheck.check.windowBytes', settings.windowBytes);
        host.settings.set('languageCheck.check.maxBytes', settings.maxBytes);
        if (settings.inlayHints !== hints.mode) {
            hints.mode = settings.inlayHints;
            hintsChanged.fire();
        }
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
            // Another document open: another in the Config tab's lists.
            void inspector.refreshConfigScope();
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
        // The top suggestion as ghost text after each finding, built as VS
        // Code builds it (Ctrl+click applies it); only while the findings
        // still describe the text, and while the options page shows them.
        vscode.languages.registerInlayHintsProvider(SELECTOR, {
            onDidChangeInlayHints: hintsChanged.event,
            provideInlayHints(doc) {
                if (!hintsVisible(hints.mode, hints.pressed) || !store.isCurrent(doc)) return [];
                const key = uriKey(doc.uri);
                return suggestionHints(doc, store.get(key) ?? [], (i) => store.idOf(key, i));
            },
        }),
        { dispose: stopFollowingKeys },
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
