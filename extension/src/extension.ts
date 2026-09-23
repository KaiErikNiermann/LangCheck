/**
 * The composition root: build the extension's parts in dependency order, wire
 * them together, and register everything with VS Code.
 *
 * The order of the statements below is load-bearing, and is pinned by
 * `test/activationOrder.test.ts`. VS Code dispatches listeners in the order
 * they were registered, the core boots on a microtask that expects the
 * triggers to exist by the first `await`, and the two `await`s here are the
 * only points where activation yields.
 */
import * as vscode from 'vscode';

import { apiCheckDocument, createAPI } from './api';
import { Checker } from './checking/checker';
import { LanguageToolRecovery } from './checking/languageToolRecovery';
import { Reloader } from './checking/reload';
import { CheckTriggers } from './checking/triggers';
import { registerCommands } from './commands';
import { COMMANDS, registerCommand } from './commands/ids';
import { ConfigStatusView } from './config/gutter';
import { ConfigWatchers } from './config/watchers';
import { getSetting } from './config/settings';
import { bootstrapCore } from './core/binary';
import { CoreService } from './core/coreService';
import { Packs } from './core/packs';
import { DiagnosticActions } from './diagnostics/actions';
import { registerCodeActions } from './providers/codeActions';
import { registerInlayHints } from './providers/inlayHints';
import { registerInlineCompletions } from './providers/inlineCompletions';
import { createServices } from './services';
import { Logger } from './shared/logger';
import { TraceLogger } from './shared/trace';
import { registerOnboarding, warnAboutOtherCopies } from './ui/onboarding';
import { InspectorPanel } from './ui/webviews/inspector';
import { SpeedFixPanel } from './ui/webviews/speedFix';

/** What deactivate() has to stop: set once activation has built it. */
let deactivateHooks: { core: CoreService; triggers: CheckTriggers } | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    const log = new Logger(isDev);
    context.subscriptions.push({ dispose: () => log.dispose() });

    const services = createServices();
    const { store, suppression, results, statusBars, configState, inspectorLog, inlayHintEmitter, inlayHintSwitch, fixTarget } = services;

    // Parts that call each other do so through these closures, which only
    // run once activation has built everything they name.
    const speedFix: SpeedFixPanel = new SpeedFixPanel({
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
    const inspector = new InspectorPanel({
        context, store, results, fixTarget, inspectorLog,
        check: document => checker.check(document),
        listConfigFiles: () => core.listConfigFiles(),
    });
    log.info('Language Check extension activated', { mode: isDev ? 'dev' : 'prod' });
    registerOnboarding(context);
    warnAboutOtherCopies(context, log);

    const traceLogger = new TraceLogger();
    context.subscriptions.push({ dispose: () => traceLogger.dispose() });
    const core = new CoreService(context, log, inspectorLog, statusBars, traceLogger, {
        booted: () => {
            triggers.checkVisibleUnchecked();
            // The core is what answers a probe, so every config on screen is
            // stale until it is up -- and stale again after a restart, which is
            // why this is here rather than only at activation.
            configStatusView.refresh();
        },
        restarted: () => triggers.checkVisibleUnchecked(),
    });
    const checker = new Checker({
        core, log, store, suppression, results, statusBars, inspectorLog,
        observer: {
            checkRecorded: (document, timings) => inspector.checkRecorded(document, timings),
            healthUpdated: () => {
                inspector.healthUpdated();
                recovery.healthUpdated();
            },
            diagnosticsPublished: diagnostics => void packs.offer(diagnostics),
        },
    });
    const actions: DiagnosticActions = new DiagnosticActions({ core, checker, log, inspectorLog, store, fixTarget, speedFix });
    const packs = new Packs({ context, core, configState, log, inspectorLog, reload: () => reloader.reinitializeAndRecheck() });
    const triggers = new CheckTriggers({ core, store, checker, configState, inspector });
    deactivateHooks = { core, triggers };

    const configStatusView = new ConfigStatusView(
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
            ? configStatusView.allSnapshots()
            : configStatusView.snapshot(uri),
    ));

    const downloading = bootstrapCore(context, log, () => core.boot());
    if (downloading) await downloading;

    // Status bars: spell-check language, and prose insights (word count, reading level)
    statusBars.create(context.subscriptions);
    // Update insights when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => statusBars.updateInsights(editor)));

    const isCheckable = (document: vscode.TextDocument) => triggers.isCheckable(document);
    const recovery = new LanguageToolRecovery({
        log, results,
        probe: () => core.probeConfig('', '', ''),
        // Not a document with unsaved edits under onSave: checking it here
        // would report on text the user has not asked to have checked.
        recheck: () => {
            const onSave = getSetting('check.trigger') === 'onSave';
            for (const editor of vscode.window.visibleTextEditors) {
                if (isCheckable(editor.document) && !(onSave && editor.document.isDirty)) {
                    void checker.check(editor.document);
                }
            }
        },
    });
    context.subscriptions.push(recovery);
    const reloader = new Reloader({ log, core, store, results, statusBars, inspector, checker, isCheckable });

    registerInlayHints(context.subscriptions, { store, configState, log, emitter: inlayHintEmitter, hintSwitch: inlayHintSwitch });
    registerInlineCompletions(context.subscriptions, { store });
    registerCodeActions(context.subscriptions, { store });
    registerCommands(context.subscriptions, {
        ...services, context, log, isDev, core, checker, actions, speedFix, inspector, packs, reloader,
    });

    // Update inspector when active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async () => {
        await inspector.update();
    }));
    triggers.register(context.subscriptions);
    await new ConfigWatchers({
        log, core, store, checker, statusBars, configState, inlayHintEmitter, reloader, configStatusView, isCheckable,
    }).start(context.subscriptions);

    // Listen for diagnostic changes to keep SpeedFix in sync
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => {
        speedFix.update();
    }));

    context.subscriptions.push(store);
    context.subscriptions.push(inlayHintEmitter);

    // Expose public API for other extensions
    return createAPI(
        () => core.client,
        uri => apiCheckDocument(core, uri),
        context.extension.packageJSON.version ?? '0.0.0',
    );
}

export function deactivate() {
    // Clean up debounce timers
    deactivateHooks?.triggers.debouncer.cancelAll();

    deactivateHooks?.core.stop();
}
