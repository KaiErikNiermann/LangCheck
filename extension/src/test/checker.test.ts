import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { Checker, type CheckerDeps } from '../checking/checker';
import { CheckResults } from '../checking/results';
import { Position, Uri } from './__mocks__/vscode';

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

function harness() {
    const pending: Answer[] = [];
    const published: string[][] = [];
    const nothing = () => undefined;
    const deps = {
        core: {
            client: {
                isRunning: true,
                sendRequest: () => new Promise<unknown>(resolve => pending.push(resolve)),
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
    } as unknown as CheckerDeps;
    return { checker: new Checker(deps), pending, published };
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
});
