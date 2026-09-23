/**
 * The extension's shared state, created once per activation.
 *
 * Every feature reaches the others through this object instead of through
 * module globals, which is what lets each live in its own module. Members only
 * call each other when an event or command runs, never while being
 * constructed, so the order below is the order of what they hold, not of what
 * they call.
 */
import * as vscode from 'vscode';

import type { Checker } from './checking/checker';
import type { Reloader } from './checking/reload';
import { CheckResults } from './checking/results';
import type { CoreService } from './core/coreService';
import type { Packs } from './core/packs';
import type { DiagnosticActions } from './diagnostics/actions';
import { WorkspaceConfigState } from './config/state';
import { FixTarget } from './diagnostics/fixTarget';
import { DiagnosticStore, Suppression } from './diagnostics/store';
import { InspectorLog } from './ui/inspectorLog';
import type { Logger } from './shared/logger';
import { StatusBars } from './ui/statusBars';
import type { InspectorPanel } from './ui/webviews/inspector';
import type { SpeedFixPanel } from './ui/webviews/speedFix';
import { InlayHintSwitch } from './providers/inlayHints';

export interface Services {
    readonly store: DiagnosticStore;
    readonly suppression: Suppression;
    readonly results: CheckResults;
    readonly configState: WorkspaceConfigState;
    readonly inspectorLog: InspectorLog;
    readonly statusBars: StatusBars;
    readonly fixTarget: FixTarget;
    /** Fired whenever an inlay hint provider's answer may have changed. */
    readonly inlayHintEmitter: vscode.EventEmitter<void>;
    readonly inlayHintSwitch: InlayHintSwitch;
}

/**
 * Everything the commands and later features reach: the shared state above
 * plus the parts built from it during activation.
 */
export interface App extends Services {
    readonly context: vscode.ExtensionContext;
    readonly log: Logger;
    /** Running from a development host, which offers the local debug core. */
    readonly isDev: boolean;
    readonly core: CoreService;
    readonly checker: Checker;
    readonly actions: DiagnosticActions;
    readonly speedFix: SpeedFixPanel;
    readonly inspector: InspectorPanel;
    readonly packs: Packs;
    readonly reloader: Reloader;
}

export function createServices(): Services {
    const results = new CheckResults();
    const store = new DiagnosticStore();
    return {
        store,
        suppression: new Suppression(),
        results,
        configState: new WorkspaceConfigState(),
        inspectorLog: new InspectorLog(),
        statusBars: new StatusBars(results),
        fixTarget: new FixTarget(store),
        inlayHintEmitter: new vscode.EventEmitter<void>(),
        inlayHintSwitch: new InlayHintSwitch(),
    };
}
