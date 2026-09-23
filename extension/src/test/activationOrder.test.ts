/**
 * The order `activate()` registers things in, pinned as a snapshot.
 *
 * VS Code dispatches listeners in the order they were registered, and several
 * behaviours here depend on it: the insights status bar is refreshed before the
 * Inspector, which runs before the check on a tab switch, and the YAML
 * suggestion is offered before an opened document is checked. What activation
 * does before its first `await` also matters, because the core boots on a
 * microtask that expects the triggers to exist by then. No e2e test can observe
 * either, so moving code out of `extension.ts` is checked against this.
 *
 * The core client is replaced: nothing is spawned, and its calls are logged
 * separately, because how many microtasks a request takes is not behaviour
 * and would make the main log flaky.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionMode } from './__mocks__/vscode';

type Mock = typeof import('./__mocks__/vscode');

const clientCalls: string[] = [];

vi.mock('../client', () => ({
    LanguageClient: class {
        isRunning = true;
        lastFailure = null;
        constructor(binaryPath: string) {
            clientCalls.push(`new(${path.basename(binaryPath)})`);
        }
        setLogger(): void {}
        setTraceLogger(): void {}
        onRestart(): void {
            clientCalls.push('onRestart');
        }
        onFailure(): void {
            clientCalls.push('onFailure');
        }
        start(): void {
            clientCalls.push('start');
        }
        stop(): void {
            clientCalls.push('stop');
        }
        async sendRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
            const kind = Object.keys(request)[0] ?? '?';
            clientCalls.push(`sendRequest(${kind})`);
            return kind === 'getMetadata' ? { getMetadata: { schemaExtensions: [] } } : {};
        }
    },
}));

const download = vi.hoisted(() => ({ present: true }));
vi.mock('../downloader', () => ({
    binaryExists: () => download.present,
    downloadBinary: async () => undefined,
}));

/** A checkout-shaped temp dir: `<root>/extension` beside `<root>/rust-core/target/release`. */
function makeLayout(withBinary: boolean): { extensionPath: string; workspace: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-activation-'));
    const extensionPath = path.join(root, 'extension');
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(extensionPath);
    fs.mkdirSync(workspace);
    if (withBinary) {
        const release = path.join(root, 'rust-core', 'target', 'release');
        fs.mkdirSync(release, { recursive: true });
        fs.writeFileSync(path.join(release, 'language-check-server'), '');
    }
    return { extensionPath, workspace };
}

function context(mock: Mock, extensionPath: string, mode: ExtensionMode) {
    const state = new Map<string, unknown>();
    return {
        subscriptions: [] as { dispose(): unknown }[],
        extensionMode: mode,
        extensionPath,
        extensionUri: mock.Uri.file(extensionPath),
        extension: { id: 'KaiErikNiermann.language-check', packageJSON: { version: '0.0.0' } },
        globalState: {
            get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
            update: async (key: string, value: unknown) => {
                state.set(key, value);
            },
        },
    };
}

/** Let the un-awaited boot and its requests run to completion. */
async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

async function activateIn(mode: ExtensionMode, withBinary: boolean) {
    // A fresh registry per scenario: extension.ts keeps its state in module
    // globals, and the mock has to be the same instance extension.ts imports.
    vi.resetModules();
    const mock: Mock = await import('./__mocks__/vscode');
    clientCalls.length = 0;
    const { extensionPath, workspace } = makeLayout(withBinary);
    mock.__workspace.folders = [{ uri: mock.Uri.file(workspace), name: 'workspace', index: 0 }];

    const extension = await import('../extension');
    const calls = mock.__calls;
    calls.push('--- activate ---');
    const ctx = context(mock, extensionPath, mode);
    const running = extension.activate(ctx as never);
    calls.push('--- first yield ---');
    await running;
    calls.push('--- activated ---');
    await settle();
    extension.deactivate();
    // How much VS Code will dispose on shutdown; a handler moved out of
    // activate() that stops being pushed here would leak.
    calls.push(`--- ${ctx.subscriptions.length} subscriptions ---`);
    return { calls: [...calls], client: [...clientCalls] };
}

describe('activation order', () => {
    beforeEach(() => {
        download.present = true;
    });

    it('under the test host, with a local core build', async () => {
        const { calls, client } = await activateIn(ExtensionMode.Test, true);
        expect(calls).toMatchSnapshot();
        expect(client).toMatchSnapshot();
    });

    it('under the test host, with no local core build', async () => {
        const { calls, client } = await activateIn(ExtensionMode.Test, false);
        expect(calls).toMatchSnapshot();
        expect(client).toMatchSnapshot();
    });

    it('in production, when the core has to be downloaded first', async () => {
        download.present = false;
        const { calls, client } = await activateIn(ExtensionMode.Production, false);
        expect(calls).toMatchSnapshot();
        expect(client).toMatchSnapshot();
    });
});
