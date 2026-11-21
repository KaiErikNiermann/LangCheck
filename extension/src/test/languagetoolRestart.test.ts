import { describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const calls: { file: string; args: readonly string[]; options: unknown }[] = [];
const errors: string[] = [];

vi.mock('child_process', () => ({
    // Docker "works" on a later turn of the event loop, as a real child does;
    // `up` fails so the test needs no LanguageTool server to poll.
    execFile: (file: string, args: readonly string[], options: unknown, callback: ExecCallback) => {
        calls.push({ file, args, options });
        setTimeout(() => callback(args.includes('up') ? new Error('no daemon') : null, '', ''), 5);
    },
}));

vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()), existsSync: () => true }));

vi.mock('vscode', () => ({
    ProgressLocation: { Notification: 15 },
    l10n: { t: (message: string) => message },
    workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] },
    window: {
        withProgress: (_options: unknown, task: (progress: { report: () => void }) => Promise<void>) => task({ report: () => undefined }),
        showErrorMessage: (message: string) => errors.push(message),
        showInformationMessage: () => undefined,
        activeTextEditor: undefined,
    },
}));

describe('restartLanguageToolDocker', () => {
    it('runs docker without blocking the event loop', async () => {
        const { restartLanguageToolDocker } = await import('../core/languagetool');
        let ticks = 0;
        const ticker = setInterval(() => ticks++, 1);

        await restartLanguageToolDocker(() => undefined);
        clearInterval(ticker);

        // execSync would have run all four commands without letting a timer fire.
        expect(ticks).toBeGreaterThan(0);
        expect(calls.map((c) => [c.file, ...c.args])).toEqual([
            ['docker', 'compose', 'down'],
            ['docker', 'compose', 'up', '-d'],
            ['docker', 'compose', 'down'],
            ['docker', 'compose', 'up', '-d'],
        ]);
        expect(calls[0]?.options).toEqual({ cwd: '/workspace', timeout: 30_000 });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('no daemon');
    });
});
