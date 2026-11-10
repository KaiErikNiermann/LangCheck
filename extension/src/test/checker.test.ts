import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

import { Checker, type CheckerDeps } from '../checking/checker';
import { CheckResults } from '../checking/results';
import { Position, Uri, workspace } from './__mocks__/vscode';

/** Resolves one pending CheckProse request. */
type Answer = (response: unknown) => void;

/** A document whose text can change between checks, as a real one does. */
function editableDocument(text: string) {
    const doc = {
        uri: Uri.file('/w/a.md'),
        fileName: '/w/a.md',
        languageId: 'markdown',
        version: 1,
        getText: () => text,
        positionAt: (offset: number) => new Position(0, offset),
        edit(next: string) { text = next; doc.version++; },
    };
    return doc;
}

/**
 * `extra` deps over the defaults; `echoWindow`: the core says which window
 * it checked, as one that knows windows does (an older one does not).
 */
function harness(extra: Partial<CheckerDeps> = {}, echoWindow = true) {
    const pending: Answer[] = [];
    const requests: { checkProse: { window?: { startByte: number; endByte: number } } }[] = [];
    const published: string[][] = [];
    const nothing = () => undefined;
    const deps = {
        core: {
            client: {
                isRunning: true,
                sendRequest: (request: (typeof requests)[number]) => new Promise<unknown>(resolve => {
                    requests.push(request);
                    pending.push(response => {
                        const check = (response as { checkProse?: object }).checkProse;
                        const window = request.checkProse.window;
                        resolve(echoWindow && check && window ? { ...response as object, checkProse: { ...check, window } } : response);
                    });
                }),
            },
        },
        log: { debug: nothing, info: nothing, warn: nothing, error: nothing },
        store: {
            publishCheck: (_uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) =>
                published.push(diagnostics.map(d => d.message)),
            notify: nothing,
        },
        suppression: { words: new Set<string>(), rules: new Set<string>() },
        results: new CheckResults(),
        statusBars: { setChecking: nothing, updateInsights: nothing, updateHealth: nothing },
        inspectorLog: { push: nothing },
        observer: { checkRecorded: nothing, healthUpdated: nothing, diagnosticsPublished: nothing },
        languageToolRestartable: () => false,
        ...extra,
    } as unknown as CheckerDeps;
    return { checker: new Checker(deps), pending, published, requests, results: deps.results };
}

const answer = (message: string) => ({
    checkProse: { diagnostics: [{ startByte: 0, endByte: 3, message }] },
});

/** Let the queued microtasks run, so a request has been sent. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Checker', () => {
    it('does not let an older check that finishes last replace a newer answer', async () => {
        const { checker, pending, published } = harness();
        const doc = editableDocument('teh old');

        const older = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        doc.edit('teh new');
        const newer = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        expect(pending).toHaveLength(2);

        pending[1]!(answer('newer'));
        await newer;
        pending[0]!(answer('older'));
        await older;

        expect(published).toEqual([['newer']]);
    });

    it('publishes an answer nothing newer has replaced', async () => {
        const { checker, pending, published } = harness();
        const doc = editableDocument('teh');

        const check = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        pending[0]!(answer('only'));
        await check;

        expect(published).toEqual([['only']]);
    });

    it('skips a queued check that a newer one replaced before it got a slot', async () => {
        const { checker, pending, published } = harness();
        const docs = ['a', 'b', 'c', 'd'].map(n => {
            const doc = editableDocument(`teh ${n}`);
            doc.uri = Uri.file(`/w/${n}.md`);
            return doc;
        });
        // Three checks fill every slot; a fourth document queues.
        const running = docs.slice(0, 3).map(d => checker.check(d as unknown as vscode.TextDocument));
        const target = docs[3]!;
        const queued = checker.check(target as unknown as vscode.TextDocument);
        await settle();
        target.edit('teh d2');
        const replacement = checker.check(target as unknown as vscode.TextDocument);
        await settle();
        expect(pending).toHaveLength(3);

        pending[0]!(answer('a'));
        await running[0];
        await settle();
        // The freed slot went to the queued check, which gave it up unasked.
        expect(await queued).toBe(-1);
        await settle();
        expect(pending).toHaveLength(4);
        pending[3]!(answer('d2'));
        await replacement;
        pending[1]!(answer('b'));
        pending[2]!(answer('c'));
        await Promise.all(running);

        expect(published).toContainEqual(['d2']);
        expect(published).toHaveLength(4);
    });

    it('does not join a check started under a config that has since changed', async () => {
        const { checker, pending, published } = harness();
        const doc = editableDocument('teh');

        const stale = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        checker.invalidate();
        // Same text, new config: joining the running check would hand back the
        // old config's answer, and nothing would ever check the file again.
        const fresh = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        expect(pending).toHaveLength(2);

        pending[1]!(answer('new config'));
        await fresh;
        pending[0]!(answer('old config'));
        await stale;

        expect(published).toEqual([['new config']]);
    });

    it('drops the answer of a check the config changed under, even with no newer check', async () => {
        const { checker, pending, published } = harness();
        const doc = editableDocument('teh');

        const stale = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        checker.invalidate();
        pending[0]!(answer('old config'));
        await stale;

        expect(published).toEqual([]);
    });
});

/** Settings for the checks of one test, as `languageCheck.check.*` keys. */
function withSettings(values: Record<string, unknown>): void {
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
        get: <T>(key: string, fallback?: T) => (key in values ? values[key] : fallback) as T,
        update: async () => undefined,
    } as never);
}

describe('Checker, progressive', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    const windowsOf = (requests: { checkProse: { window?: { startByte: number; endByte: number } } }[]) =>
        requests.map(r => (r.checkProse.window ? [r.checkProse.window.startByte, r.checkProse.window.endByte] : 'whole'));

    it('checks a long document first a window at a time, the one in focus first, showing each as it lands; then whole', async () => {
        withSettings({ 'check.progressive': true, 'check.windowBytes': 1024 });
        const { checker, pending, published, requests, results } = harness({ focusOf: () => 1500 });
        const doc = editableDocument('a'.repeat(3000));
        const done = checker.check(doc as unknown as vscode.TextDocument);
        for (const message of ['B', 'A', 'C']) {
            await settle();
            pending.shift()!(answer(message));
        }
        expect(await done).toBe(3);
        expect(windowsOf(requests)).toEqual([[1024, 2048], [0, 1024], [2048, 3000]]);
        // In document order, the windows' answers so far.
        expect(published).toEqual([['B'], ['A', 'B'], ['A', 'B', 'C']]);
        expect(results.checkedWhole.has(doc.uri.toString())).toBe(true);

        const again = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        pending.shift()!(answer('A'));
        await again;
        expect(windowsOf(requests).at(-1)).toBe('whole');
    });

    it('an edit stops the windows, and the next check starts over in windows', async () => {
        withSettings({ 'check.progressive': true, 'check.windowBytes': 1024 });
        const { checker, pending, requests, results } = harness();
        const doc = editableDocument('a'.repeat(3000));
        const first = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        doc.edit('b'.repeat(3000));
        const second = checker.check(doc as unknown as vscode.TextDocument);
        pending.shift()!(answer('old'));
        await first;
        // The first sequence stopped after its first window.
        expect(windowsOf(requests)).toEqual([[0, 1024], [0, 1024]]);
        for (let i = 0; i < 3; i++) {
            await settle();
            pending.shift()!(answer('new'));
        }
        await second;
        expect(windowsOf(requests).slice(1)).toEqual([[0, 1024], [1024, 2048], [2048, 3000]]);
        expect(results.checkedWhole.size).toBe(1);
    });

    it('a window that brings no answer (cut off on the way) stops the windows, and the document is not taken as checked', async () => {
        withSettings({ 'check.progressive': true, 'check.windowBytes': 1024 });
        const { checker, pending, requests, results } = harness();
        const doc = editableDocument('a'.repeat(3000));
        const done = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        pending.shift()!(answer('A'));
        await settle();
        pending.shift()!({ id: 0 });
        await done;
        expect(requests).toHaveLength(2);
        expect(results.checkedWhole.size).toBe(0);
    });

    it('is off by default, and a short document is checked whole', async () => {
        const long = harness();
        const check = long.checker.check(editableDocument('a'.repeat(100_000)) as unknown as vscode.TextDocument);
        await settle();
        long.pending.shift()!(answer('A'));
        await check;
        expect(windowsOf(long.requests)).toEqual(['whole']);

        withSettings({ 'check.progressive': true, 'check.windowBytes': 1024 });
        const short = harness();
        const shortCheck = short.checker.check(editableDocument('a'.repeat(1024)) as unknown as vscode.TextDocument);
        await settle();
        short.pending.shift()!(answer('A'));
        await shortCheck;
        expect(windowsOf(short.requests)).toEqual(['whole']);
    });

    it('maxBytes bounds every check, whole ones too', async () => {
        withSettings({ 'check.maxBytes': 2000 });
        const { checker, pending, requests } = harness();
        const done = checker.check(editableDocument('a'.repeat(3000)) as unknown as vscode.TextDocument);
        await settle();
        pending.shift()!(answer('A'));
        await done;
        expect(windowsOf(requests)).toEqual([[0, 2000]]);
    });

    it('a window size outside its bounds is held to them', async () => {
        withSettings({ 'check.progressive': true, 'check.windowBytes': 3 });
        const { checker, pending, requests } = harness();
        const done = checker.check(editableDocument('a'.repeat(2048)) as unknown as vscode.TextDocument);
        for (let i = 0; i < 2; i++) {
            await settle();
            pending.shift()!(answer('A'));
        }
        await done;
        expect(windowsOf(requests)).toEqual([[0, 1024], [1024, 2048]]);
    });

    it('a core older than windows checks the whole text for the first: taken as the whole check, not repeated per window', async () => {
        withSettings({ 'check.progressive': true, 'check.windowBytes': 1024 });
        const { checker, pending, published, requests, results } = harness({}, false);
        const doc = editableDocument('a'.repeat(3000));
        const done = checker.check(doc as unknown as vscode.TextDocument);
        await settle();
        pending.shift()!(answer('A'));
        expect(await done).toBe(1);
        expect(requests).toHaveLength(1);
        expect(published).toEqual([['A']]);
        expect(results.checkedWhole.size).toBe(1);
    });

    describe('foreign findings', () => {
        const finding = (from: number, to: number) => ({
            checker: 'typst', rule: 'misspelling', category: 'spelling' as const, from, to, message: '', language: 'en',
        });

        it('go with the check of the text they were read against, in bytes', async () => {
            let foreign = [finding(6, 9)];
            const { checker, pending, requests } = harness({ foreignOf: () => foreign });
            const doc = editableDocument('Größe teh');
            const check = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            expect((requests[0]!.checkProse as { foreign?: unknown }).foreign).toEqual([
                { checker: 'typst', rule: 'misspelling', category: 1, startByte: 8, endByte: 11, message: '', language: 'en' },
            ]);
            pending[0]!(answer('x'));
            await check;

            foreign = [];
            const plain = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            expect(requests[1]!.checkProse).not.toHaveProperty('foreign');
            pending[1]!(answer('y'));
            await plain;
        });

        it('with another message at the same span are not the same: the running check is not joined', async () => {
            let message = 'the word "teh" seems to be misspelled';
            const { checker, pending, requests } = harness({ foreignOf: () => [{ ...finding(0, 3), message }] });
            const doc = editableDocument('teh');
            const first = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            message = 'das Wort "teh" scheint falsch geschrieben';
            const second = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            expect(requests).toHaveLength(2);
            pending[0]!(answer('a'));
            pending[1]!(answer('b'));
            await Promise.all([first, second]);
        });

        it('join a running check only when they are the same, as the text is', async () => {
            let foreign = [finding(0, 3)];
            const { checker, pending, requests } = harness({ foreignOf: () => foreign });
            const doc = editableDocument('teh');
            const first = checker.check(doc as unknown as vscode.TextDocument);
            const joined = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            expect(requests).toHaveLength(1);
            // The host's checker answered meanwhile: same text, a new question.
            foreign = [];
            const fresh = checker.check(doc as unknown as vscode.TextDocument);
            await settle();
            expect(requests).toHaveLength(2);
            pending[0]!(answer('a'));
            pending[1]!(answer('b'));
            await Promise.all([first, joined, fresh]);
        });
    });
});
