import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { CheckResults } from '../checking/results';
import { StatusBars } from '../ui/statusBars';
import { __statusBarItems, window } from './__mocks__/vscode';

/** An editor over plain prose, enough for the insights to count. */
const editor = {
    document: { uri: { toString: () => 'file:///doc.md' }, getText: () => 'One short sentence here.' },
} as unknown as vscode.TextEditor;

describe('StatusBars health indicator', () => {
    let results: CheckResults;
    let bars: StatusBars;
    let insights: (typeof __statusBarItems)[number];

    beforeEach(() => {
        __statusBarItems.length = 0;
        (window as { activeTextEditor: unknown }).activeTextEditor = editor;
        results = new CheckResults();
        bars = new StatusBars(results);
        bars.create([]);
        insights = __statusBarItems[1]!;
        results.engineHealth = [{ name: 'languagetool', status: 'down', consecutiveFailures: 3, lastError: 'refused', lastSuccessEpochMs: 0 }];
    });

    it('still shows LanguageTool down once the check that found it has finished', () => {
        // The order a check runs these in.
        bars.setChecking(true);
        bars.updateHealth();
        bars.setChecking(false);
        expect(insights.text).toBe('$(pencil) 4 words | ARI 4.1 $(error) LT down');
    });

    it('shows the suffix once, however often health is reported', () => {
        bars.updateInsights(editor);
        bars.updateHealth();
        bars.updateHealth();
        expect(insights.text).toBe('$(pencil) 4 words | ARI 4.1 $(error) LT down');
    });

    it('drops the suffix and the colour when LanguageTool recovers', () => {
        bars.updateInsights(editor);
        bars.updateHealth();
        results.engineHealth = [{ name: 'languagetool', status: 'ok', consecutiveFailures: 0, lastError: '', lastSuccessEpochMs: 1 }];
        bars.updateHealth();
        bars.updateInsights(editor);
        expect(insights.text).toBe('$(pencil) 4 words | ARI 4.1');
        expect(insights.backgroundColor).toBeUndefined();
    });
});

describe('CheckResults.forget', () => {
    it('drops a closed document, and only it', () => {
        const results = new CheckResults();
        for (const uri of ['file:///a.md', 'file:///b.md']) {
            results.extraction.set(uri, { prose: [], languageId: 'markdown', syntax: 'markdown', maxRangeBytes: 0, version: 1 });
            results.names.set(uri, []);
        }
        results.forget('file:///a.md');
        expect([...results.extraction.keys()]).toEqual(['file:///b.md']);
        expect([...results.names.keys()]).toEqual(['file:///b.md']);
    });
});
