import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

import { CheckResults } from '../checking/results';
import { CheckTriggers, type TriggerDeps } from '../checking/triggers';
import { uriKey } from '../shared/documents';
import { Uri } from './__mocks__/vscode';

const document = { uri: Uri.file('/w/a.md'), fileName: '/w/a.md', languageId: 'markdown' } as unknown as vscode.TextDocument;

function harness() {
    const results = new CheckResults();
    const stored = new Set<string>();
    const check = vi.fn();
    const deps = {
        core: { ready: () => true, schemaExtensions: new Set<string>() },
        store: { has: (key: string) => stored.has(key) },
        results,
        checker: { check },
    } as unknown as TriggerDeps;
    return { triggers: new CheckTriggers(deps), results, stored, check };
}

describe('CheckTriggers.checkIfUnchecked', () => {
    it('leaves a document alone that was checked since it was opened', () => {
        const { triggers, results, stored, check } = harness();
        const key = uriKey(document.uri);
        stored.add(key);
        results.extraction.set(key, { prose: [], languageId: 'markdown', syntax: '', maxRangeBytes: 0, version: 1 });

        triggers.checkIfUnchecked(document);

        expect(check).not.toHaveBeenCalled();
    });

    it('checks a reopened document whose diagnostics outlived its close', () => {
        // The Problems panel keeps a closed file's diagnostics; the file may
        // have changed on disk since.
        const { triggers, results, stored, check } = harness();
        const key = uriKey(document.uri);
        stored.add(key);
        results.extraction.set(key, { prose: [], languageId: 'markdown', syntax: '', maxRangeBytes: 0, version: 1 });
        results.forget(key);

        triggers.checkIfUnchecked(document);

        expect(check).toHaveBeenCalledWith(document);
    });
});
