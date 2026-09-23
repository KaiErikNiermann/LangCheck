import type * as vscode from 'vscode';

import type { InspectorEvent } from './webviews/protocol';

/**
 * The Inspector's event log, which anything in the extension may write to.
 *
 * Events go to the panel while it is open and are dropped otherwise; the log is
 * a live view of the pipeline, not a history.
 */
export class InspectorLog {
    private webview: vscode.Webview | undefined;

    attach(webview: vscode.Webview): void {
        this.webview = webview;
    }

    detach(): void {
        this.webview = undefined;
    }

    /** Push a timestamped event to the Inspector (if open). */
    push(level: InspectorEvent['level'], source: string, message: string, extra?: { durationMs?: number; details?: string }): void {
        const evt: InspectorEvent = { timestamp: Date.now(), level, source, message };
        if (extra?.durationMs !== undefined) evt.durationMs = extra.durationMs;
        if (extra?.details !== undefined) evt.details = extra.details;
        this.webview?.postMessage({ type: 'pushEvent', payload: evt });
    }
}
