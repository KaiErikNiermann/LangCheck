/**
 * What a window with many documents open costs.
 *
 * `diagnosticsMap` lives in memory, so a reload starts with nothing and every
 * check has to be paid for again. The question that matters is how many: a
 * window holding ten restored tabs must not fire ten checks at the core the
 * moment it comes back, and VS Code opens documents for plenty of reasons
 * that have nothing to do with the user looking at them -- search, git,
 * go-to-definition.
 *
 * So the guard is visibility, and this is where it is held to that.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

suite('many open documents', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('a document opened without being shown is not checked', async function () {
        this.timeout(60_000);
        // One visible document establishes that the extension is checking at
        // all, so a silent result for the others means they were skipped
        // rather than that nothing was working.
        const visible = fixture('notes.md');
        await openInEditor(visible);
        await eventually(
            'the visible document to be checked',
            () => (ourDiagnostics(visible).length > 0 ? true : undefined),
            30_000,
        );

        // Loaded the way a search result or a git diff loads one: the open
        // event fires, no editor shows it.
        const background = fixture('third.md');
        await vscode.workspace.openTextDocument(background);
        await new Promise(resolve => setTimeout(resolve, 5_000));

        assert.deepStrictEqual(
            ourDiagnostics(background).map(d => d.message),
            [],
            'a document nobody is looking at was sent to the core',
        );
    });

    test('showing it afterwards checks it', async function () {
        this.timeout(60_000);
        // The other half: skipping an invisible document must not mean it is
        // skipped for good, or opening a search result and then clicking into
        // it would leave a permanently unchecked file.
        const background = fixture('third.md');
        await openInEditor(background);
        await eventually(
            'the document to be checked once it is shown',
            () => (ourDiagnostics(background).length > 0 ? true : undefined),
            30_000,
        );
    });

    test('a document already checked is not re-checked when it becomes active again', async function () {
        this.timeout(60_000);
        // Tab switching goes through the same entry point as opening, and it
        // is guarded on already having diagnostics. Without that guard, moving
        // between two tabs would check on every switch.
        const first = fixture('notes.md');
        const second = fixture('third.md');
        await openInEditor(first);
        await eventually(
            'the first document to be checked',
            () => (ourDiagnostics(first).length > 0 ? true : undefined),
            30_000,
        );
        const before = ourDiagnostics(first).length;

        await openInEditor(second);
        await openInEditor(first);
        await new Promise(resolve => setTimeout(resolve, 3_000));

        assert.strictEqual(
            ourDiagnostics(first).length,
            before,
            'switching back changed the diagnostics, so the document was checked again',
        );
    });
});
