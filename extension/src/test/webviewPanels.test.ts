import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';

import { CheckResults } from '../checking/results';
import { FixTarget } from '../diagnostics/fixTarget';
import { DiagnosticStore } from '../diagnostics/store';
import { InspectorLog } from '../ui/inspectorLog';
import { InspectorPanel } from '../ui/webviews/inspector';
import { SpeedFixPanel } from '../ui/webviews/speedFix';

/** An event as VS Code's: a listener's disposable goes into `disposables` when given. */
function event<T>() {
    const listeners = new Set<(e: T) => unknown>();
    return {
        event: (listener: (e: T) => unknown, _this?: unknown, disposables?: vscode.Disposable[]) => {
            listeners.add(listener);
            const d = { dispose: () => { listeners.delete(listener); } };
            disposables?.push(d);
            return d;
        },
        fire: (e: T) => { for (const l of [...listeners]) l(e); },
    };
}

/** A webview panel that closes when told to, as the user closing its tab. */
function fakePanel() {
    const received = event<unknown>();
    const disposed = event<void>();
    return {
        webview: { html: '', cspSource: '', onDidReceiveMessage: received.event, postMessage: () => Promise.resolve(true), asWebviewUri: (uri: vscode.Uri) => uri },
        onDidDispose: disposed.event,
        reveal: () => {},
        dispose: () => { disposed.fire(); },
    };
}

/** Opens and closes the panel `times` times and returns what the extension's subscriptions hold afterwards. */
function cycle(open: () => void, times: number): number {
    const panels: ReturnType<typeof fakePanel>[] = [];
    (vscode.window as unknown as { createWebviewPanel: () => unknown }).createWebviewPanel = () => {
        const panel = fakePanel();
        panels.push(panel);
        return panel;
    };
    for (let i = 0; i < times; i++) {
        open();
        panels.at(-1)?.dispose();
    }
    return panels.length;
}

const context = () => ({ subscriptions: [] as vscode.Disposable[], extensionPath: '/ext', extension: { packageJSON: {} } }) as unknown as vscode.ExtensionContext;

describe('webview panels', () => {
    // VS Code keeps the extension's subscriptions until it deactivates: a
    // listener registered there per open kept every closed panel alive.
    it('SpeedFix leaves nothing in the extension\'s subscriptions once closed', () => {
        const ctx = context();
        const store = new DiagnosticStore();
        const panel = new SpeedFixPanel({
            context: ctx, store, fixTarget: new FixTarget(store),
            actions: { applyFix: () => Promise.resolve(), ignore: () => Promise.resolve(), check: () => Promise.resolve(0) },
        });
        expect(cycle(() => { panel.open(); }, 3)).toBe(3);
        expect(ctx.subscriptions).toHaveLength(0);
    });

    it('the Inspector leaves nothing in the extension\'s subscriptions once closed', () => {
        const ctx = context();
        const store = new DiagnosticStore();
        const panel = new InspectorPanel({
            context: ctx, store, results: new CheckResults(), fixTarget: new FixTarget(store), inspectorLog: new InspectorLog(),
            check: () => Promise.resolve(0), listConfigFiles: () => Promise.resolve(null),
            environment: { hasDockerCompose: () => false, detectEngineInfo: () => Promise.resolve([]) },
        });
        expect(cycle(() => { panel.open(); }, 3)).toBe(3);
        expect(ctx.subscriptions).toHaveLength(0);
    });
});
