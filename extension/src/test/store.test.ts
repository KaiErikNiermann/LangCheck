import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';

import type { ExtendedDiagnostic } from '../diagnostics/diagnostic';
import { DiagnosticStore } from '../diagnostics/store';

const URI = vscode.Uri.parse('file:/doc.md');
const finding = (message: string) => ({ message }) as unknown as ExtendedDiagnostic;
const documentAt = (version: number) => ({ uri: URI, version }) as unknown as vscode.TextDocument;

describe('DiagnosticStore.resolve', () => {
    function published(version = 3) {
        const store = new DiagnosticStore();
        store.publishCheck(URI, [finding('a'), finding('b')], version);
        return store;
    }
    const key = URI.toString() as Parameters<DiagnosticStore['idOf']>[0];

    it('finds a finding by the id it was handed out under, while the text is the one checked', () => {
        const store = published();
        expect(store.resolve(store.idOf(key, 1), documentAt(3))?.diagnostic.message).toBe('b');
    });

    it('refuses once the document has changed since the check', () => {
        const store = published();
        expect(store.isCurrent(documentAt(4))).toBe(false);
        expect(store.resolve(store.idOf(key, 0), documentAt(4))).toBeUndefined();
    });

    it('refuses an id from a list since replaced, though its index exists in the new one', () => {
        // The SpeedFix race: the panel still shows the old list, whose
        // index 0 is now a different finding.
        const store = published();
        const old = store.idOf(key, 0);
        store.write(key, URI, [finding('b')]);
        expect(store.resolve(old, documentAt(3))).toBeUndefined();
        expect(store.resolve(store.idOf(key, 0), documentAt(3))?.diagnostic.message).toBe('b');
    });

    it('refuses an id from before a clear, and an index out of range', () => {
        const store = published();
        const before = store.idOf(key, 0);
        store.clear();
        store.publishCheck(URI, [finding('a')], 3);
        expect(store.resolve(before, documentAt(3))).toBeUndefined();
        expect(store.resolve(store.idOf(key, 5), documentAt(3))).toBeUndefined();
    });

    it('refuses what is not an id', () => {
        const store = published();
        expect(store.resolve('diag-0', documentAt(3))).toBeUndefined();
        expect(store.resolve('', documentAt(3))).toBeUndefined();
    });

    it('says whether the list a finding came from is still the store\'s, for a write after an await', () => {
        const store = published();
        const found = store.resolve(store.idOf(key, 0), documentAt(3));
        expect(found && store.holds(key, found.generation)).toBe(true);
        // A check lands while the action awaits.
        store.publishCheck(URI, [finding('b')], 3);
        expect(found && store.holds(key, found.generation)).toBe(false);
    });
});

