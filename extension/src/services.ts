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

import { CheckResults } from './checking/results';
import { WorkspaceConfigState } from './config/state';
import { FixTarget } from './diagnostics/fixTarget';
import { DiagnosticStore, Suppression } from './diagnostics/store';
import { InspectorLog } from './ui/inspectorLog';
import { StatusBars } from './ui/statusBars';

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
    };
}
