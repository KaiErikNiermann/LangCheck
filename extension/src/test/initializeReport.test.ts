import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreService } from '../core/coreService';
import { conflictLogLines, describeServer } from '../core/initializeReport';
import type { languagecheck } from '../proto/checker';
import type { Logger } from '../shared/logger';
import type { TraceLogger } from '../shared/trace';
import type { InspectorLog } from '../ui/inspectorLog';
import type { StatusBars } from '../ui/statusBars';
import { ExtensionMode, Uri, __workspace, window } from './__mocks__/vscode';

/** What the mocked core answers Initialize with; each test sets it. */
const answer = vi.hoisted(() => ({ current: {} as languagecheck.IResponse }));

vi.mock('../core/client', () => ({
    LanguageClient: class {
        isRunning = true;
        setLogger(): void {}
        setTraceLogger(): void {}
        onRestart(): void {}
        onFailure(): void {}
        start(): void {}
        stop(): void {}
        async sendRequest(request: languagecheck.IRequest): Promise<languagecheck.IResponse> {
            return request.initialize ? answer.current : { getMetadata: {} };
        }
    },
}));

const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const holder = { pid: 1234, version: '0.6.1', executable: '/old/folder/language-check-server' };
const self = { pid: 5678, version: '0.6.2', executable: '/home/u/.vscode/extensions/lc/bin/language-check-server' };

describe('what Initialize could not set up', () => {
    const logged: string[] = [];
    const log = {
        debug() {}, info() {}, show: vi.fn(),
        warn: (message: string) => logged.push(message),
        error: (message: string, data?: unknown) => logged.push(`${message} ${JSON.stringify(data)}`),
    } as unknown as Logger;
    let shown: ReturnType<typeof vi.spyOn>;

    const makeCore = () => new CoreService(
        { extensionMode: ExtensionMode.Test, extensionPath: os.tmpdir() } as never,
        log,
        { push() {} } as unknown as InspectorLog,
        { setChecking() {} } as unknown as StatusBars,
        { logEvent() {} } as unknown as TraceLogger,
        { booted() {}, restarted() {} },
    );

    beforeEach(() => {
        logged.length = 0;
        shown = vi.spyOn(window, 'showWarningMessage');
        __workspace.folders = [{ uri: Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-init-'))), name: 'w', index: 0 }];
    });

    afterEach(() => {
        shown.mockRestore();
        __workspace.folders = undefined;
    });

    it('names both servers, with process ids and paths, in the notification and the log', async () => {
        answer.current = { initialize: { otherServer: holder, thisServer: self, warnings: ['Another language-check server ... is using this index'] } };
        const core = makeCore();
        core.start();
        await core.initialize();
        await settle();

        expect(shown).toHaveBeenCalledTimes(1);
        const message = String(shown.mock.calls[0]?.[0]);
        expect(message).toContain('1234');
        expect(message).toContain('/old/folder/language-check-server');
        expect(message).toContain('5678');
        expect(shown.mock.calls[0]?.[1]).toBe('Show Log');
        const log = logged.join('\n');
        expect(log).toContain(describeServer(holder));
        expect(log).toContain(describeServer(self));
        expect(log).toContain('kill 1234');
    });

    it('does not repeat the notification when a config change initializes again', async () => {
        answer.current = { initialize: { otherServer: holder, thisServer: self, warnings: [] } };
        const core = makeCore();
        core.start();
        await core.initialize();
        await core.initialize();
        await settle();
        expect(shown).toHaveBeenCalledTimes(1);
    });

    it('shows a warning that names no other server as it is', async () => {
        answer.current = { initialize: { thisServer: self, warnings: ['The SLS schemas could not be loaded, so none are in use: bad.yaml'] } };
        const core = makeCore();
        core.start();
        await core.initialize();
        await settle();
        expect(String(shown.mock.calls[0]?.[0])).toContain('bad.yaml');
    });

    it('reports an Initialize the core answered with an error, which used to pass as success', async () => {
        answer.current = { error: { message: 'Database already open. Cannot acquire lock.' } };
        const core = makeCore();
        core.start();
        await core.initialize();
        await settle();
        expect(String(shown.mock.calls[0]?.[0])).toContain('Database already open');
    });

    it('says nothing when an older core answers Ok', async () => {
        answer.current = { ok: {} };
        const core = makeCore();
        core.start();
        await core.initialize();
        await settle();
        expect(shown).not.toHaveBeenCalled();
    });
});

describe('conflictLogLines', () => {
    it('suggests deleting the other binary only when it is a different file', () => {
        expect(conflictLogLines(holder, self).join('\n')).toContain('deleting /old/folder/language-check-server');
        expect(conflictLogLines({ ...holder, executable: self.executable }, self).join('\n')).not.toContain('deleting');
    });
});
