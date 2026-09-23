import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapCore } from '../core/binary';
import { CoreService } from '../core/coreService';
import type { Logger } from '../shared/logger';
import type { TraceLogger } from '../shared/trace';
import type { InspectorLog } from '../ui/inspectorLog';
import type { StatusBars } from '../ui/statusBars';
import { ExtensionMode, Uri, __workspace } from './__mocks__/vscode';

const restartHandlers = vi.hoisted(() => [] as (() => unknown)[]);

vi.mock('../core/client', () => ({
    LanguageClient: class {
        isRunning = true;
        setLogger(): void {}
        setTraceLogger(): void {}
        onRestart(handler: () => unknown): void {
            restartHandlers.push(handler);
        }
        onFailure(): void {}
        start(): void {}
        stop(): void {}
        async sendRequest(): Promise<never> {
            throw new Error('core exited');
        }
    },
}));

const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

describe('a failing Initialize', () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    beforeEach(() => {
        unhandled.length = 0;
        process.on('unhandledRejection', onUnhandled);
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-core-'));
        __workspace.folders = [{ uri: Uri.file(workspace), name: 'workspace', index: 0 }];
    });

    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        __workspace.folders = undefined;
    });

    const warnings: string[] = [];
    const log = {
        debug() {}, info() {}, error() {},
        warn: (message: string) => warnings.push(message),
    } as unknown as Logger;
    const makeCore = () => new CoreService(
            { extensionMode: ExtensionMode.Test, extensionPath: os.tmpdir() } as never,
            log,
            { push() {} } as unknown as InspectorLog,
            { setChecking() {} } as unknown as StatusBars,
            { logEvent() {} } as unknown as TraceLogger,
        { booted() {}, restarted() {} },
    );

    it('after the restart command is reported, not left unhandled', async () => {
        warnings.length = 0;
        makeCore().restart();
        await settle();
        expect(unhandled).toEqual([]);
        expect(warnings).toContain('Core initialize failed after a restart');
    });

    it('after the client recovers a crashed process is reported, not left unhandled', async () => {
        warnings.length = 0;
        restartHandlers.length = 0;
        makeCore().start();
        // What the client does after respawning a process that died.
        void restartHandlers[0]?.();
        await settle();
        expect(unhandled).toEqual([]);
        expect(warnings).toContain('Core initialize failed after the process was restarted');
    });

    it('during activation is reported, not left unhandled', async () => {
        warnings.length = 0;
        const localBuild = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-ext-'));
        const release = path.join(localBuild, 'rust-core', 'target', 'release');
        fs.mkdirSync(release, { recursive: true });
        fs.writeFileSync(path.join(release, 'language-check-server'), '');
        fs.mkdirSync(path.join(localBuild, 'extension'));
        bootstrapCore(
            { extensionMode: ExtensionMode.Test, extensionPath: path.join(localBuild, 'extension') } as never,
            log,
            () => Promise.reject(new Error('core exited')),
        );
        await settle();
        expect(unhandled).toEqual([]);
        expect(warnings).toContain('Core failed to start');
    });
});
